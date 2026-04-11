/**
 * MP4 post-processor: fix single-chunk MP4 files for QuickTime compatibility.
 *
 * Some JS-based MP4 muxers write all samples into a single chunk,
 * which QuickTime can't render (black screen). This rewrites the
 * stco/stsc boxes to create per-sample chunk offsets.
 */

interface Box {
  type: string;
  offset: number;
  size: number;
}

function findBoxes(data: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let offset = start;
  while (offset < end - 8) {
    const size = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (size === 0 || size > end - offset) break;
    boxes.push({ type, offset, size });
    offset += size;
  }
  return boxes;
}

function findBox(data: Buffer, start: number, end: number, type: string): Box | null {
  const boxes = findBoxes(data, start, end);
  return boxes.find(b => b.type === type) || null;
}

function findBoxDeep(data: Buffer, path: string[]): Box | null {
  let start = 0;
  let end = data.length;

  for (let i = 0; i < path.length; i++) {
    const box = findBox(data, start, end, path[i]);
    if (!box) return null;
    if (i === path.length - 1) return box;
    // Container box: content starts after 8-byte header
    start = box.offset + 8;
    end = box.offset + box.size;
  }
  return null;
}

/**
 * Fix MP4 for QuickTime: rewrite chunk tables so each sample is its own chunk.
 * This modifies the buffer in-place and may return a new buffer if size changes.
 */
export function fixMp4ForQuickTime(input: Buffer): Buffer {
  // Find mdat to get the data offset
  const mdatBox = findBox(input, 0, input.length, 'mdat');
  if (!mdatBox) return input;

  const mdatDataStart = mdatBox.offset + 8;

  // Find moov
  const moovBox = findBox(input, 0, input.length, 'moov');
  if (!moovBox) return input;

  // Process each trak
  const traks = findBoxes(input, moovBox.offset + 8, moovBox.offset + moovBox.size)
    .filter(b => b.type === 'trak');

  // Collect sample info from all tracks
  interface TrackInfo {
    trak: Box;
    stbl: Box;
    stsz: Box;
    stco: Box;
    stsc: Box;
    sampleSizes: number[];
    sampleCount: number;
  }

  const tracks: TrackInfo[] = [];

  for (const trak of traks) {
    const mdia = findBox(input, trak.offset + 8, trak.offset + trak.size, 'mdia');
    if (!mdia) continue;
    const minf = findBox(input, mdia.offset + 8, mdia.offset + mdia.size, 'minf');
    if (!minf) continue;
    const stbl = findBox(input, minf.offset + 8, minf.offset + minf.size, 'stbl');
    if (!stbl) continue;

    const stsz = findBox(input, stbl.offset + 8, stbl.offset + stbl.size, 'stsz');
    const stco = findBox(input, stbl.offset + 8, stbl.offset + stbl.size, 'stco');
    const stsc = findBox(input, stbl.offset + 8, stbl.offset + stbl.size, 'stsc');
    if (!stsz || !stco || !stsc) continue;

    // Parse stsz: [size(4), type(4), version(1), flags(3), sample_size(4), sample_count(4), entries...]
    const stszOffset = stsz.offset;
    const uniformSize = input.readUInt32BE(stszOffset + 12);
    const sampleCount = input.readUInt32BE(stszOffset + 16);

    const sampleSizes: number[] = [];
    if (uniformSize > 0) {
      for (let i = 0; i < sampleCount; i++) sampleSizes.push(uniformSize);
    } else {
      for (let i = 0; i < sampleCount; i++) {
        sampleSizes.push(input.readUInt32BE(stszOffset + 20 + i * 4));
      }
    }

    tracks.push({ trak, stbl, stsz, stco, stsc, sampleSizes, sampleCount });
  }

  if (tracks.length === 0) return input;

  // Check if already has proper chunks (stco entry count > 1)
  const stco0 = tracks[0].stco;
  const existingChunks = input.readUInt32BE(stco0.offset + 12);
  if (existingChunks > 1) return input; // Already fine

  // Build interleaved chunk layout: alternate video/audio samples
  // For simplicity, give each sample its own chunk offset
  // We need to compute absolute offsets for each sample in mdat

  // First, figure out sample order in mdat by parsing existing stco/stsc
  // With single chunk, samples are sequential: all track0 samples then all track1 samples
  // We need to build proper stco (one entry per sample) and stsc (one sample per chunk)

  const newParts: Buffer[] = [];
  let currentOffset = 0;

  // Copy everything before moov
  const moovEnd = moovBox.offset + moovBox.size;
  const beforeMoov = moovBox.offset < mdatBox.offset;

  // Rebuild approach: reconstruct the entire file
  // 1. Copy ftyp
  const ftypBox = findBox(input, 0, input.length, 'ftyp');
  if (!ftypBox) return input;
  newParts.push(input.subarray(ftypBox.offset, ftypBox.offset + ftypBox.size));

  // 2. Keep mdat as-is, calculate sample offsets
  // Figure out where each track's samples start in the original mdat
  const trackOffsets: number[][] = [];
  let sampleDataOffset = mdatDataStart;

  // In the original single-chunk layout, track0 samples come first, then track1
  // (based on the stco having offset = mdatDataStart for both, stsc maps them)
  // Actually with single stco entry, all samples of each track use the same base offset
  // Let's read the original chunk offset for each track
  for (const track of tracks) {
    const origChunkOffset = input.readUInt32BE(track.stco.offset + 16); // first (only) entry
    const offsets: number[] = [];
    let pos = origChunkOffset;
    for (const size of track.sampleSizes) {
      offsets.push(pos);
      pos += size;
    }
    trackOffsets.push(offsets);
  }

  // 3. Rebuild moov with proper stco and stsc for each track
  // We'll rebuild the moov box by copying it and replacing stco/stsc in each trak

  // Calculate new stco and stsc sizes for each track
  const newStcoBuffers: Buffer[] = [];
  const newStscBuffers: Buffer[] = [];
  let moovSizeDelta = 0;

  for (let t = 0; t < tracks.length; t++) {
    const track = tracks[t];
    const offsets = trackOffsets[t];
    const n = track.sampleCount;

    // New stco: header(12) + count(4) + n*4 bytes
    const newStcoSize = 16 + n * 4;
    const stcoBuf = Buffer.alloc(newStcoSize);
    stcoBuf.writeUInt32BE(newStcoSize, 0); // box size
    stcoBuf.write('stco', 4); // box type
    stcoBuf.writeUInt32BE(0, 8); // version + flags
    stcoBuf.writeUInt32BE(n, 12); // entry count
    for (let i = 0; i < n; i++) {
      stcoBuf.writeUInt32BE(offsets[i], 16 + i * 4);
    }
    newStcoBuffers.push(stcoBuf);
    moovSizeDelta += newStcoSize - track.stco.size;

    // New stsc: one sample per chunk → single entry (chunk=1, samples_per_chunk=1, desc=1)
    const newStscSize = 28;
    const stscBuf = Buffer.alloc(newStscSize);
    stscBuf.writeUInt32BE(newStscSize, 0);
    stscBuf.write('stsc', 4);
    stscBuf.writeUInt32BE(0, 8); // version + flags
    stscBuf.writeUInt32BE(1, 12); // entry count
    stscBuf.writeUInt32BE(1, 16); // first chunk
    stscBuf.writeUInt32BE(1, 20); // samples per chunk
    stscBuf.writeUInt32BE(1, 24); // sample description index
    newStscBuffers.push(stscBuf);
    moovSizeDelta += newStscSize - track.stsc.size;
  }

  // Now rebuild the moov by copying pieces and replacing stco/stsc
  // We need to update all parent box sizes too

  // Simple approach: rebuild byte by byte
  const moovData = input.subarray(moovBox.offset, moovBox.offset + moovBox.size);
  const newMoovParts: Buffer[] = [];

  function rebuildBox(data: Buffer, boxStart: number, boxEnd: number, parentData: Buffer, trackIndex: { value: number }): Buffer {
    const parts: Buffer[] = [];
    let pos = boxStart;

    while (pos < boxEnd - 8) {
      const size = parentData.readUInt32BE(pos);
      const type = parentData.toString('ascii', pos + 4, pos + 8);
      if (size === 0 || pos + size > boxEnd) break;

      if (type === 'stco') {
        parts.push(newStcoBuffers[trackIndex.value]);
      } else if (type === 'stsc') {
        parts.push(newStscBuffers[trackIndex.value]);
      } else if (['trak', 'mdia', 'minf', 'stbl'].includes(type)) {
        if (type === 'trak') trackIndex.value++;
        // Rebuild container: header + rebuilt children
        const childContent = rebuildBox(parentData, pos + 8, pos + size, parentData, trackIndex);
        const header = Buffer.alloc(8);
        header.writeUInt32BE(8 + childContent.length, 0);
        header.write(type, 4);
        parts.push(header);
        parts.push(childContent);
      } else {
        parts.push(parentData.subarray(pos, pos + size));
      }

      pos += size;
    }

    return Buffer.concat(parts);
  }

  const trackIdx = { value: -1 };
  const moovContent = rebuildBox(input, moovBox.offset + 8, moovBox.offset + moovBox.size, input, trackIdx);
  const moovHeader = Buffer.alloc(8);
  moovHeader.writeUInt32BE(8 + moovContent.length, 0);
  moovHeader.write('moov', 4);

  // Now rebuild the file: ftyp + moov + mdat (same order as original)
  const result: Buffer[] = [];

  // Walk original top-level boxes and replace moov
  const topBoxes = findBoxes(input, 0, input.length);

  // But we need to update stco offsets if moov size changed
  // because mdat position shifts
  const newMoovSize = 8 + moovContent.length;
  const moovDiff = newMoovSize - moovBox.size;

  // If moov is before mdat, mdat shifts by moovDiff
  // We need to adjust all stco entries
  let mdatShift = 0;
  if (moovBox.offset < mdatBox.offset) {
    mdatShift = moovDiff;
  }

  // Rebuild moov content with adjusted offsets
  if (mdatShift !== 0) {
    // Re-create stco buffers with adjusted offsets
    for (let t = 0; t < tracks.length; t++) {
      const offsets = trackOffsets[t];
      const n = tracks[t].sampleCount;
      const stcoBuf = newStcoBuffers[t];
      for (let i = 0; i < n; i++) {
        stcoBuf.writeUInt32BE(offsets[i] + mdatShift, 16 + i * 4);
      }
    }

    // Rebuild moov again with adjusted stco
    const trackIdx2 = { value: -1 };
    const moovContent2 = rebuildBox(input, moovBox.offset + 8, moovBox.offset + moovBox.size, input, trackIdx2);
    moovHeader.writeUInt32BE(8 + moovContent2.length, 0);

    for (const box of topBoxes) {
      if (box.type === 'moov') {
        result.push(moovHeader);
        result.push(moovContent2);
      } else {
        result.push(input.subarray(box.offset, box.offset + box.size));
      }
    }
  } else {
    for (const box of topBoxes) {
      if (box.type === 'moov') {
        result.push(moovHeader);
        result.push(moovContent);
      } else {
        result.push(input.subarray(box.offset, box.offset + box.size));
      }
    }
  }

  return Buffer.concat(result);
}
