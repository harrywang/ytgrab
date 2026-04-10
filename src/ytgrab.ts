/**
 * YtGrab - Main orchestrator class
 * Ported from yt_dlp/YoutubeDL.py
 *
 * Coordinates extractors, downloaders, and post-processors.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { YoutubeIE, YoutubePlaylistIE, YoutubeSearchIE } from './extractor/youtube.js';
import { InfoExtractor } from './extractor/common.js';
import { getSuitableDownloader } from './downloader/index.js';
import {
  FFmpegExtractAudioPP, FFmpegVideoConvertorPP, FFmpegMergerPP,
  FFmpegMetadataPP, FFmpegEmbedSubtitlePP,
} from './postprocessor/ffmpeg.js';
import { PostProcessor } from './postprocessor/common.js';
import {
  sanitizeFilename, formatBytes, ExtractorError, UnsupportedError,
} from './utils/index.js';
import { makeRequest } from './networking/index.js';
import type {
  InfoDict, VideoFormat, YtGrabOptions, ProgressHook, Subtitle,
} from './types.js';

export class YtGrab {
  readonly params: YtGrabOptions;
  private _extractors: InfoExtractor[] = [];
  private _postProcessors: PostProcessor[] = [];
  private _progressHooks: ProgressHook[] = [];

  constructor(options: YtGrabOptions = {}) {
    this.params = {
      format: 'best',
      output: '%(title)s [%(id)s].%(ext)s',
      quiet: false,
      verbose: false,
      retries: 10,
      ...options,
    };

    // Register extractors
    this._extractors = [
      new YoutubeIE(),
      new YoutubePlaylistIE(),
      new YoutubeSearchIE(),
    ];
    for (const ie of this._extractors) {
      ie.setDownloader(this);
    }

    // Register progress hooks
    if (options.progressHooks) {
      this._progressHooks.push(...options.progressHooks);
    }

    // Set up post-processors based on options
    this._setupPostProcessors();
  }

  private _setupPostProcessors(): void {
    if (this.params.extractAudio) {
      this._postProcessors.push(
        new FFmpegExtractAudioPP(this, this.params.audioFormat || 'mp3', this.params.audioQuality || '5')
      );
    }
    if (this.params.mergeOutputFormat) {
      this._postProcessors.push(new FFmpegVideoConvertorPP(this, this.params.mergeOutputFormat));
    }
    if (this.params.embedSubtitles) {
      this._postProcessors.push(new FFmpegEmbedSubtitlePP(this));
    }
    if (this.params.embedMetadata) {
      this._postProcessors.push(new FFmpegMetadataPP(this));
    }
  }

  // --- Public API ---

  /**
   * Extract info from a URL without downloading.
   */
  async getInfo(url: string): Promise<InfoDict> {
    return this.extractInfo(url, false);
  }

  /**
   * Extract info and download.
   */
  async download(urls: string | string[]): Promise<InfoDict[]> {
    const urlList = Array.isArray(urls) ? urls : [urls];
    const results: InfoDict[] = [];

    for (const url of urlList) {
      const info = await this.extractInfo(url, true);

      if (info._type === 'playlist' && Array.isArray(info.entries)) {
        for (const entry of info.entries) {
          if (entry._type === 'url' && entry.url) {
            const videoInfo = await this.extractInfo(entry.url, true);
            results.push(videoInfo);
          } else {
            results.push(entry);
          }
        }
      } else {
        results.push(info);
      }
    }

    return results;
  }

  /**
   * List available formats for a URL.
   */
  async listFormats(url: string): Promise<VideoFormat[]> {
    const info = await this.getInfo(url);
    return info.formats || [];
  }

  /**
   * List available subtitles for a URL.
   */
  async listSubtitles(url: string): Promise<{
    subtitles: Record<string, Subtitle[]>;
    automatic_captions: Record<string, Subtitle[]>;
  }> {
    const info = await this.getInfo(url);
    return {
      subtitles: info.subtitles || {},
      automatic_captions: info.automatic_captions || {},
    };
  }

  // --- Core logic ---

  async extractInfo(url: string, download: boolean = true): Promise<InfoDict> {
    const ie = this._findExtractor(url);
    if (!ie) throw new UnsupportedError(url);

    const info = await ie.extract(url);

    if (download && !this.params.simulate && !this.params.skipDownload) {
      if (info._type === 'playlist') {
        return info; // Caller handles playlist entries
      }
      await this.processInfo(info);
    }

    return info;
  }

  async processInfo(info: InfoDict): Promise<void> {
    if (!info.formats || info.formats.length === 0) {
      this.toScreen(`[ytgrab] ${info.id}: No formats available`);
      return;
    }

    // List formats if requested
    if (this.params.listFormats) {
      this._printFormats(info.formats);
      return;
    }

    // List subtitles if requested
    if (this.params.listSubtitles) {
      this._printSubtitles(info);
      return;
    }

    // Select format
    const selectedFormat = this._selectFormat(info.formats, this.params.format || 'best');
    if (!selectedFormat) {
      throw new ExtractorError('No suitable format found');
    }

    // Prepare filename
    const filename = this._prepareFilename(info, selectedFormat);
    info.filepath = filename;
    info.ext = selectedFormat.ext;
    info.format = `${selectedFormat.format_id} - ${selectedFormat.height || '?'}p`;
    info.format_id = selectedFormat.format_id;

    // Write info JSON
    if (this.params.writeInfoJson) {
      await this._writeInfoJson(info, filename);
    }

    // Write description
    if (this.params.writeDescription && info.description) {
      const descPath = filename.replace(/\.[^.]+$/, '.description');
      fs.writeFileSync(descPath, info.description, 'utf-8');
      this.toScreen(`[info] Writing description to: ${descPath}`);
    }

    // Download thumbnails
    if (this.params.writeThumbnail && info.thumbnails?.length) {
      await this._downloadThumbnail(info, filename);
    }

    // Download subtitles
    if ((this.params.writeSubtitles || this.params.writeAutoSubtitles) && info.subtitles) {
      await this._downloadSubtitles(info, filename);
    }

    // Download the video
    this.toScreen(`[download] ${info.title}`);
    this.toScreen(`[download] Format: ${selectedFormat.format_id} (${selectedFormat.ext}, ${selectedFormat.height || '?'}p)`);

    const downloader = getSuitableDownloader(selectedFormat, this);
    const infoForDownload: InfoDict = {
      ...info,
      url: selectedFormat.url,
      http_headers: selectedFormat.http_headers,
    };

    await downloader.realDownload(filename, infoForDownload);

    // Run post-processors
    let currentInfo: InfoDict = { ...info, filepath: filename };
    const filesToDelete: string[] = [];

    for (const pp of this._postProcessors) {
      try {
        const [toDelete, modifiedInfo] = await pp.run(currentInfo);
        filesToDelete.push(...toDelete);
        currentInfo = modifiedInfo;
      } catch (err) {
        this.reportWarning(`Post-processor ${pp.PP_NAME} failed: ${(err as Error).message}`);
      }
    }

    // Clean up temp files
    for (const f of filesToDelete) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  }

  // --- Format selection ---

  private _selectFormat(formats: VideoFormat[], formatSpec: string): VideoFormat | null {
    if (formats.length === 0) return null;

    // Filter out formats without URLs
    const available = formats.filter(f => f.url);
    if (available.length === 0) return null;

    switch (formatSpec) {
      case 'best':
      case 'bestvideo+bestaudio':
        return available[available.length - 1]; // Already sorted

      case 'worst':
        return available[0];

      case 'bestaudio':
        return available
          .filter(f => f.acodec && f.acodec !== 'none')
          .sort((a, b) => (a.abr || a.tbr || 0) - (b.abr || b.tbr || 0))
          .pop() || available[available.length - 1];

      case 'bestvideo':
        return available
          .filter(f => f.vcodec && f.vcodec !== 'none')
          .sort((a, b) => (a.height || 0) - (b.height || 0))
          .pop() || available[available.length - 1];

      default: {
        // Try format_id match
        const byId = available.find(f => f.format_id === formatSpec);
        if (byId) return byId;

        // Try height match like "720" or "1080p"
        const heightMatch = formatSpec.match(/^(\d+)p?$/);
        if (heightMatch) {
          const targetHeight = parseInt(heightMatch[1]);
          // Find closest format with video
          const withVideo = available.filter(f => f.height && f.vcodec !== 'none');
          if (withVideo.length > 0) {
            withVideo.sort((a, b) =>
              Math.abs((a.height || 0) - targetHeight) - Math.abs((b.height || 0) - targetHeight)
            );
            return withVideo[0];
          }
        }

        return available[available.length - 1]; // Fallback to best
      }
    }
  }

  // --- Filename preparation ---

  private _prepareFilename(info: InfoDict, format: VideoFormat): string {
    let template = this.params.output || '%(title)s [%(id)s].%(ext)s';

    const fields: Record<string, string> = {
      id: info.id,
      title: sanitizeFilename(info.title || 'Unknown'),
      ext: format.ext || 'mp4',
      uploader: sanitizeFilename(info.uploader || 'Unknown'),
      channel: sanitizeFilename(info.channel || 'Unknown'),
      upload_date: info.upload_date || '',
      duration: info.duration ? String(info.duration) : '',
      view_count: info.view_count ? String(info.view_count) : '',
      height: format.height ? String(format.height) : '',
      width: format.width ? String(format.width) : '',
      format_id: format.format_id || '',
      resolution: format.height ? `${format.width || '?'}x${format.height}` : '',
    };

    let filename = template;
    for (const [key, val] of Object.entries(fields)) {
      filename = filename.replace(new RegExp(`%\\(${key}\\)s`, 'g'), val);
    }

    // Handle output paths
    const outputDir = this.params.paths?.home || process.cwd();
    return path.join(outputDir, filename);
  }

  // --- Subtitle download ---

  private async _downloadSubtitles(info: InfoDict, filename: string): Promise<void> {
    const languages = this.params.subtitleLanguages || ['en'];
    const format = this.params.subtitleFormat || 'srt';

    // Determine which subtitles to download
    let subsToDownload: Record<string, Subtitle[]> = {};

    if (this.params.writeSubtitles && info.subtitles) {
      for (const lang of languages) {
        if (info.subtitles[lang]) {
          subsToDownload[lang] = info.subtitles[lang];
        }
      }
    }

    if (this.params.writeAutoSubtitles && info.automatic_captions) {
      for (const lang of languages) {
        if (!subsToDownload[lang] && info.automatic_captions[lang]) {
          subsToDownload[lang] = info.automatic_captions[lang];
        }
      }
    }

    const subtitleFiles: string[] = [];

    for (const [lang, subs] of Object.entries(subsToDownload)) {
      // Find the preferred format
      const sub = subs.find(s => s.ext === format) || subs[0];
      if (!sub?.url) continue;

      const subPath = filename.replace(/\.[^.]+$/, `.${lang}.${sub.ext}`);
      this.toScreen(`[info] Downloading subtitles: ${lang} (${sub.ext})`);

      try {
        const subDir = path.dirname(subPath);
        if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

        // Use got-scraping for subtitle downloads (handles TLS fingerprinting)
        let subContent: string = '';
        try {
          const { gotScraping } = await import('got-scraping');
          const subResp = await gotScraping({
            url: sub.url,
            headerGeneratorOptions: {
              browsers: [{ name: 'chrome', minVersion: 120 }],
              locales: ['en-US'],
              operatingSystems: ['windows'],
            },
          });
          subContent = subResp.body;
        } catch {
          // Fallback to Node.js HTTP
          const resp = await makeRequest(sub.url);
          subContent = resp.text();
        }

        fs.writeFileSync(subPath, subContent, 'utf-8');
        subtitleFiles.push(subPath);
      } catch (err) {
        this.reportWarning(`Failed to download ${lang} subtitles: ${(err as Error).message}`);
      }
    }

    // Store for subtitle embedding post-processor
    (info as any).__subtitle_files = subtitleFiles;
  }

  // --- Thumbnail download ---

  private async _downloadThumbnail(info: InfoDict, filename: string): Promise<void> {
    const thumbnails = info.thumbnails || [];
    // Get the best quality thumbnail
    const thumb = thumbnails[thumbnails.length - 1];
    if (!thumb?.url) return;

    const thumbPath = filename.replace(/\.[^.]+$/, '.jpg');
    this.toScreen(`[info] Downloading thumbnail`);

    try {
      const resp = await makeRequest(thumb.url);
      fs.writeFileSync(thumbPath, resp.body);
    } catch (err) {
      this.reportWarning(`Failed to download thumbnail: ${(err as Error).message}`);
    }
  }

  // --- Info JSON ---

  private async _writeInfoJson(info: InfoDict, filename: string): Promise<void> {
    const jsonPath = filename.replace(/\.[^.]+$/, '.info.json');
    const { filepath, ...infoWithoutFilepath } = info;
    fs.writeFileSync(jsonPath, JSON.stringify(infoWithoutFilepath, null, 2), 'utf-8');
    this.toScreen(`[info] Writing info JSON to: ${jsonPath}`);
  }

  // --- Output ---

  private _printFormats(formats: VideoFormat[]): void {
    console.log('\nAvailable formats:');
    console.log('─'.repeat(100));
    console.log(
      'ID'.padEnd(12) +
      'EXT'.padEnd(6) +
      'RESOLUTION'.padEnd(14) +
      'FPS'.padEnd(6) +
      'FILESIZE'.padEnd(12) +
      'TBR'.padEnd(8) +
      'VCODEC'.padEnd(14) +
      'ACODEC'.padEnd(14) +
      'NOTE'
    );
    console.log('─'.repeat(100));

    for (const f of formats) {
      const resolution = f.height ? `${f.width || '?'}x${f.height}` : 'audio only';
      console.log(
        (f.format_id || '?').padEnd(12) +
        (f.ext || '?').padEnd(6) +
        resolution.padEnd(14) +
        (f.fps ? `${f.fps}` : '').padEnd(6) +
        (f.filesize ? formatBytes(f.filesize) : '~').padEnd(12) +
        (f.tbr ? `${f.tbr}k` : '').padEnd(8) +
        (f.vcodec || 'none').padEnd(14) +
        (f.acodec || 'none').padEnd(14) +
        (f.format_note || '')
      );
    }
    console.log('');
  }

  private _printSubtitles(info: InfoDict): void {
    const printSubs = (title: string, subs: Record<string, Subtitle[]>) => {
      const langs = Object.keys(subs);
      if (langs.length === 0) return;
      console.log(`\n${title} (${langs.length} languages):`);
      for (const lang of langs.sort()) {
        const formats = subs[lang].map(s => s.ext).filter((v, i, a) => a.indexOf(v) === i);
        console.log(`  ${lang}: ${formats.join(', ')}`);
      }
    };

    printSubs('Manual subtitles', info.subtitles || {});
    printSubs('Automatic captions', info.automatic_captions || {});
  }

  // --- Extractor lookup ---

  private _findExtractor(url: string): InfoExtractor | null {
    for (const ie of this._extractors) {
      if (ie.suitable(url)) return ie;
    }
    return null;
  }

  // --- Logging (used by extractors/downloaders) ---

  toScreen(msg: string): void {
    if (this.params.quiet) return;
    console.log(msg);
  }

  reportWarning(msg: string): void {
    console.warn(`WARNING: ${msg}`);
  }

  reportError(msg: string): void {
    console.error(`ERROR: ${msg}`);
  }
}
