/**
 * HLS (M3U8) Downloader - ported from yt_dlp/downloader/hls.py
 * Downloads HTTP Live Streaming content by fetching fragments.
 * Uses mux.js for pure-JS TS→MP4 transmuxing (no FFmpeg required).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { FileDownloader } from './common.js';
import { makeRequest } from '../networking/index.js';
import type { InfoDict } from '../types.js';
import { formatBytes } from '../utils/index.js';

export class HlsFD extends FileDownloader {
  async realDownload(filename: string, infoDict: InfoDict): Promise<boolean> {
    const manifestUrl: string | undefined = (infoDict.url || (infoDict as any).manifest_url) as string | undefined;
    if (!manifestUrl) throw new Error('No HLS manifest URL');

    this.ensureDir(filename);
    this.reportDestination(filename);

    // Download manifest
    this._log('Downloading HLS manifest');
    const manifestResp = await makeRequest(manifestUrl, {
      headers: (infoDict.http_headers as Record<string, string>) ?? {},
    });
    const manifest = manifestResp.text();

    // Parse fragments
    const fragments = this._parseMediaPlaylist(manifest, manifestUrl);
    if (fragments.length === 0) {
      throw new Error('No fragments found in HLS manifest');
    }

    this._log(`Downloading ${fragments.length} fragments`);

    const startTime = Date.now();
    let downloadedBytes = 0;
    const tsChunks: Buffer[] = [];

    for (let i = 0; i < fragments.length; i++) {
      const frag = fragments[i];
      try {
        const resp = await makeRequest(frag.url, {
          headers: {
            ...(infoDict.http_headers as Record<string, string>) ?? {},
            'Accept-Encoding': 'identity', // Don't compress binary TS segments
          },
          timeout: 60000,
        });

        if (resp.status >= 400) {
          throw new Error(`HTTP ${resp.status} for fragment ${i + 1}`);
        }

        tsChunks.push(resp.body);
        downloadedBytes += resp.body.length;

        this._hookProgress({
          status: 'downloading',
          downloaded_bytes: downloadedBytes,
          fragment_index: i + 1,
          fragment_count: fragments.length,
          elapsed: (Date.now() - startTime) / 1000,
          speed: this.calcSpeed(startTime, Date.now(), downloadedBytes) ?? undefined,
        });
      } catch (err) {
        this._log(`Fragment ${i + 1}/${fragments.length} failed: ${(err as Error).message}`);
        // For 403 errors, abort immediately (likely n-param issue)
        if ((err as Error).message.includes('403')) throw err;
        // For other errors (network), continue
      }
    }

    // Transmux TS→MP4 using mux.js (pure JS, no FFmpeg)
    const tsData = Buffer.concat(tsChunks);

    if (filename.endsWith('.mp4')) {
      try {
        const mp4Data = await this._transmuxToMp4(tsData);
        fs.writeFileSync(filename, mp4Data);
        downloadedBytes = mp4Data.length;
        this._log('Transmuxed to MP4');
      } catch (err) {
        this._log(`Transmux failed: ${(err as Error).message} - saving raw TS`);
        fs.writeFileSync(filename, tsData);
      }
    } else {
      fs.writeFileSync(filename, tsData);
    }

    this.reportFinished(filename, downloadedBytes);
    return true;
  }

  private async _transmuxToMp4(tsData: Buffer): Promise<Buffer> {
    // Dynamic import to avoid issues with ESM/CJS
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const muxjs = require('mux.js') as typeof import('mux.js');
    const Transmuxer = (muxjs as any).mp4?.Transmuxer || (muxjs as any).default?.mp4?.Transmuxer;

    if (!Transmuxer) {
      throw new Error('mux.js Transmuxer not found');
    }

    return new Promise<Buffer>((resolve, reject) => {
      const transmuxer = new Transmuxer();
      const outputChunks: Uint8Array[] = [];
      let initSegment: Uint8Array | null = null;

      transmuxer.on('data', (segment: { initSegment: Uint8Array; data: Uint8Array }) => {
        if (!initSegment) {
          initSegment = segment.initSegment;
          outputChunks.push(segment.initSegment);
        }
        outputChunks.push(segment.data);
      });

      transmuxer.on('done', () => {
        if (outputChunks.length === 0) {
          reject(new Error('No output from transmuxer'));
          return;
        }
        const totalLen = outputChunks.reduce((sum, c) => sum + c.length, 0);
        const result = Buffer.alloc(totalLen);
        let offset = 0;
        for (const chunk of outputChunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        resolve(result);
      });

      transmuxer.on('error', (err: Error) => {
        reject(err);
      });

      // Feed all TS data and flush
      transmuxer.push(new Uint8Array(tsData));
      transmuxer.flush();
    });
  }

  private _parseMediaPlaylist(manifest: string, baseUrl: string): { url: string; duration: number }[] {
    const fragments: { url: string; duration: number }[] = [];
    const lines = manifest.split('\n');
    let duration = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        const match = line.match(/#EXTINF:([\d.]+)/);
        if (match) duration = parseFloat(match[1]);
      } else if (line && !line.startsWith('#')) {
        const fragUrl = line.startsWith('http') ? line : new URL(line, baseUrl).toString();
        fragments.push({ url: fragUrl, duration });
        duration = 0;
      }
    }

    return fragments;
  }
}
