/**
 * FFmpeg PostProcessor - ported from yt_dlp/postprocessor/ffmpeg.py
 *
 * Handles audio extraction, format conversion, merging, and metadata embedding.
 */

import { execFileSync, execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PostProcessor } from './common.js';
import type { InfoDict } from '../types.js';

function findFFmpeg(customPath?: string): string | null {
  if (customPath) {
    if (fs.existsSync(customPath)) return customPath;
  }
  // Try common locations
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return null;
  }
}

function findFFprobe(customPath?: string): string | null {
  if (customPath) {
    const probe = customPath.replace(/ffmpeg$/, 'ffprobe');
    if (fs.existsSync(probe)) return probe;
  }
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return 'ffprobe';
  } catch {
    return null;
  }
}

export class FFmpegPostProcessor extends PostProcessor {
  protected _ffmpegPath: string | null;
  protected _ffprobePath: string | null;

  constructor(downloader?: any) {
    super(downloader);
    const customPath = downloader?.params?.ffmpegLocation;
    this._ffmpegPath = findFFmpeg(customPath);
    this._ffprobePath = findFFprobe(customPath);
  }

  ppKey(): string { return 'FFmpeg'; }

  get available(): boolean {
    return this._ffmpegPath !== null;
  }

  async run(information: InfoDict): Promise<[string[], InfoDict]> {
    return [[], information];
  }

  protected _runFFmpeg(inputPath: string, outputPath: string, opts: string[]): void {
    if (!this._ffmpegPath) {
      throw new Error('FFmpeg not found. Install FFmpeg or set ffmpegLocation option.');
    }

    const args = [
      '-y', // Overwrite output
      '-i', inputPath,
      ...opts,
      outputPath,
    ];

    this._log(`Running: ffmpeg ${args.join(' ')}`);

    try {
      execFileSync(this._ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 600000, // 10 min timeout
      });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || '';
      throw new Error(`FFmpeg error: ${stderr.slice(-500)}`);
    }
  }

  protected _runFFmpegMultipleFiles(
    inputPaths: string[],
    outputPath: string,
    opts: string[],
  ): void {
    if (!this._ffmpegPath) {
      throw new Error('FFmpeg not found.');
    }

    const args: string[] = ['-y'];
    for (const input of inputPaths) {
      args.push('-i', input);
    }
    args.push(...opts, outputPath);

    this._log(`Running: ffmpeg ${args.join(' ')}`);

    try {
      execFileSync(this._ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 600000,
      });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || '';
      throw new Error(`FFmpeg error: ${stderr.slice(-500)}`);
    }
  }
}

// --- Extract Audio ---

const ACODECS: Record<string, { ext: string; encoder: string; opts: string[] }> = {
  mp3: { ext: 'mp3', encoder: 'libmp3lame', opts: ['-q:a', '2'] },
  aac: { ext: 'aac', encoder: 'aac', opts: ['-b:a', '192k'] },
  opus: { ext: 'opus', encoder: 'libopus', opts: ['-b:a', '128k'] },
  vorbis: { ext: 'ogg', encoder: 'libvorbis', opts: ['-q:a', '5'] },
  flac: { ext: 'flac', encoder: 'flac', opts: [] },
  wav: { ext: 'wav', encoder: 'pcm_s16le', opts: [] },
  m4a: { ext: 'm4a', encoder: 'aac', opts: ['-b:a', '192k'] },
};

export class FFmpegExtractAudioPP extends FFmpegPostProcessor {
  private _preferredCodec: string;
  private _preferredQuality: string;

  constructor(downloader?: any, preferredCodec: string = 'mp3', preferredQuality: string = '5') {
    super(downloader);
    this._preferredCodec = preferredCodec;
    this._preferredQuality = preferredQuality;
  }

  ppKey(): string { return 'FFmpegExtractAudio'; }

  async run(information: InfoDict): Promise<[string[], InfoDict]> {
    const filepath = information.filepath as string;
    if (!filepath || !fs.existsSync(filepath)) {
      return [[], information];
    }

    const codecInfo = ACODECS[this._preferredCodec] || ACODECS.mp3;
    const ext = path.extname(filepath).slice(1);
    const newPath = filepath.replace(/\.[^.]+$/, `.${codecInfo.ext}`);

    if (filepath === newPath) {
      return [[], information];
    }

    this._log(`Extracting audio to ${codecInfo.ext}`);

    const opts = [
      '-vn', // No video
      '-acodec', codecInfo.encoder,
      ...codecInfo.opts,
    ];

    this._runFFmpeg(filepath, newPath, opts);

    return [[filepath], { ...information, filepath: newPath, ext: codecInfo.ext }];
  }
}

// --- Video Converter ---

export class FFmpegVideoConvertorPP extends FFmpegPostProcessor {
  private _preferredFormat: string;

  constructor(downloader?: any, preferredFormat: string = 'mp4') {
    super(downloader);
    this._preferredFormat = preferredFormat;
  }

  ppKey(): string { return 'FFmpegVideoConvertor'; }

  async run(information: InfoDict): Promise<[string[], InfoDict]> {
    const filepath = information.filepath as string;
    if (!filepath || !fs.existsSync(filepath)) {
      return [[], information];
    }

    const ext = path.extname(filepath).slice(1);
    if (ext === this._preferredFormat) {
      return [[], information];
    }

    const newPath = filepath.replace(/\.[^.]+$/, `.${this._preferredFormat}`);
    this._log(`Converting to ${this._preferredFormat}`);

    const opts = ['-c', 'copy'];
    this._runFFmpeg(filepath, newPath, opts);

    return [[filepath], { ...information, filepath: newPath, ext: this._preferredFormat }];
  }
}

// --- Merge Formats (video + audio) ---

export class FFmpegMergerPP extends FFmpegPostProcessor {
  ppKey(): string { return 'FFmpegMerger'; }

  async run(information: InfoDict): Promise<[string[], InfoDict]> {
    const requestedFormats = information.requested_formats;
    if (!requestedFormats || requestedFormats.length < 2) {
      return [[], information];
    }

    const filePaths = requestedFormats
      .map(f => (f as any).filepath as string)
      .filter(Boolean);

    if (filePaths.length < 2) return [[], information];

    const outputExt = (information.ext as string) || 'mkv';
    const outputPath = (information.filepath as string) || filePaths[0].replace(/\.[^.]+$/, `.${outputExt}`);

    this._log('Merging video and audio');

    const opts = ['-c', 'copy'];
    // Map all input streams
    for (let i = 0; i < filePaths.length; i++) {
      opts.push('-map', String(i));
    }

    this._runFFmpegMultipleFiles(filePaths, outputPath, opts);

    return [filePaths, { ...information, filepath: outputPath }];
  }
}

// --- Embed Subtitles ---

export class FFmpegEmbedSubtitlePP extends FFmpegPostProcessor {
  ppKey(): string { return 'FFmpegEmbedSubtitle'; }

  async run(information: InfoDict): Promise<[string[], InfoDict]> {
    const filepath = information.filepath as string;
    if (!filepath) return [[], information];

    const subtitleFiles = (information as any).__subtitle_files as string[] | undefined;
    if (!subtitleFiles || subtitleFiles.length === 0) return [[], information];

    const ext = path.extname(filepath).slice(1);
    if (!['mp4', 'mkv', 'webm'].includes(ext)) {
      this._warn(`Cannot embed subtitles in ${ext} format`);
      return [[], information];
    }

    const tmpPath = filepath.replace(/\.[^.]+$/, `.tmp.${ext}`);

    const inputs = [filepath, ...subtitleFiles];
    const opts: string[] = ['-c', 'copy', '-map', '0'];
    for (let i = 0; i < subtitleFiles.length; i++) {
      opts.push('-map', String(i + 1));
    }
    opts.push('-c:s', ext === 'mp4' ? 'mov_text' : 'srt');

    this._log('Embedding subtitles');
    this._runFFmpegMultipleFiles(inputs, tmpPath, opts);

    fs.renameSync(tmpPath, filepath);
    return [subtitleFiles, information];
  }
}

// --- Embed Metadata ---

export class FFmpegMetadataPP extends FFmpegPostProcessor {
  ppKey(): string { return 'FFmpegMetadata'; }

  async run(information: InfoDict): Promise<[string[], InfoDict]> {
    const filepath = information.filepath as string;
    if (!filepath || !fs.existsSync(filepath)) {
      return [[], information];
    }

    const ext = path.extname(filepath).slice(1);
    const tmpPath = filepath.replace(/\.[^.]+$/, `.tmp.${ext}`);

    const opts: string[] = ['-c', 'copy'];

    if (information.title) opts.push('-metadata', `title=${information.title}`);
    if (information.uploader) opts.push('-metadata', `artist=${information.uploader}`);
    if (information.upload_date) opts.push('-metadata', `date=${information.upload_date}`);
    if (information.description) opts.push('-metadata', `comment=${information.description.slice(0, 1000)}`);

    if (opts.length <= 2) return [[], information]; // No metadata to embed

    this._log('Embedding metadata');
    this._runFFmpeg(filepath, tmpPath, opts);

    fs.renameSync(tmpPath, filepath);
    return [[], information];
  }
}

export { PostProcessor } from './common.js';
