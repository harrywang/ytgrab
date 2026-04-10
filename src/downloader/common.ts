/**
 * Base FileDownloader - ported from yt_dlp/downloader/common.py
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { InfoDict, DownloadProgress, ProgressHook } from '../types.js';
import { formatBytes } from '../utils/index.js';

export abstract class FileDownloader {
  protected _ydl: any;
  protected _progressHooks: ProgressHook[] = [];

  constructor(ydl: any) {
    this._ydl = ydl;
    if (ydl?.params?.progressHooks) {
      this._progressHooks.push(...ydl.params.progressHooks);
    }
  }

  abstract realDownload(filename: string, infoDict: InfoDict): Promise<boolean>;

  addProgressHook(hook: ProgressHook): void {
    this._progressHooks.push(hook);
  }

  protected _hookProgress(progress: DownloadProgress): void {
    for (const hook of this._progressHooks) {
      try { hook(progress); } catch { /* ignore hook errors */ }
    }
  }

  protected tempName(filename: string): string {
    return `${filename}.part`;
  }

  protected undoTempName(filename: string): string {
    return filename.replace(/\.part$/, '');
  }

  protected reportDestination(filename: string): void {
    this._log(`Destination: ${filename}`);
  }

  protected reportProgress(downloaded: number, total: number | null, startTime: number): void {
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = elapsed > 0 ? downloaded / elapsed : 0;
    const eta = total && speed > 0 ? Math.round((total - downloaded) / speed) : undefined;

    this._hookProgress({
      status: 'downloading',
      downloaded_bytes: downloaded,
      total_bytes: total ?? undefined,
      elapsed,
      speed,
      eta,
    });
  }

  protected reportFinished(filename: string, filesize: number): void {
    this._log(`Download completed: ${filename} (${formatBytes(filesize)})`);
    this._hookProgress({
      status: 'finished',
      filename,
      downloaded_bytes: filesize,
      total_bytes: filesize,
    });
  }

  protected calcSpeed(start: number, now: number, bytes: number): number | null {
    const elapsed = (now - start) / 1000;
    if (elapsed <= 0) return null;
    return bytes / elapsed;
  }

  protected calcEta(start: number, now: number, total: number, current: number): number | null {
    const elapsed = (now - start) / 1000;
    if (elapsed <= 0 || current <= 0) return null;
    const rate = current / elapsed;
    return Math.round((total - current) / rate);
  }

  protected ensureDir(filepath: string): void {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  protected _log(msg: string): void {
    if (this._ydl?.params?.quiet) return;
    if (this._ydl) {
      this._ydl.toScreen(`[download] ${msg}`);
    } else {
      console.log(`[download] ${msg}`);
    }
  }
}
