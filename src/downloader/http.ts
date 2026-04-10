/**
 * HTTP Downloader - ported from yt_dlp/downloader/http.py
 * Downloads files via HTTP/HTTPS with resume support.
 */

import * as fs from 'node:fs';
import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';
import { FileDownloader } from './common.js';
import type { InfoDict } from '../types.js';
import { formatBytes } from '../utils/index.js';

export class HttpFD extends FileDownloader {
  async realDownload(filename: string, infoDict: InfoDict): Promise<boolean> {
    const url = infoDict.url || (infoDict.formats?.[0]?.url);
    if (!url) throw new Error('No URL to download');

    this.ensureDir(filename);
    const tmpFilename = this.tempName(filename);

    // Check for resume
    let resumeLen = 0;
    if (fs.existsSync(tmpFilename)) {
      resumeLen = fs.statSync(tmpFilename).size;
    }

    this.reportDestination(filename);

    return new Promise<boolean>((resolve, reject) => {
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        ...(infoDict.http_headers || {}),
      };

      if (resumeLen > 0) {
        headers['Range'] = `bytes=${resumeLen}-`;
        this._log(`Resuming download from ${formatBytes(resumeLen)}`);
      }

      const req = transport.request(parsedUrl, { method: 'GET', headers }, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, parsedUrl);
          const redirectInfoDict = { ...infoDict, url: redirectUrl.toString() };
          this.realDownload(filename, redirectInfoDict).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP Error ${res.statusCode}`));
          return;
        }

        const contentLength = res.headers['content-length']
          ? parseInt(res.headers['content-length'], 10)
          : null;
        const totalBytes = contentLength ? contentLength + resumeLen : null;

        const openMode = resumeLen > 0 && res.statusCode === 206 ? 'a' : 'w';
        const stream = fs.createWriteStream(tmpFilename, { flags: openMode === 'a' ? 'a' : 'w' });

        let downloadedBytes = resumeLen;
        const startTime = Date.now();

        const progressInterval = setInterval(() => {
          this.reportProgress(downloadedBytes, totalBytes, startTime);
        }, 1000);

        res.on('data', (chunk: Buffer) => {
          stream.write(chunk);
          downloadedBytes += chunk.length;
        });

        res.on('end', () => {
          clearInterval(progressInterval);
          stream.end(() => {
            // Rename temp file to final name
            try {
              if (fs.existsSync(filename)) fs.unlinkSync(filename);
              fs.renameSync(tmpFilename, filename);
            } catch (err) {
              // If rename fails (cross-device), copy and delete
              fs.copyFileSync(tmpFilename, filename);
              fs.unlinkSync(tmpFilename);
            }
            this.reportFinished(filename, downloadedBytes);
            resolve(true);
          });
        });

        res.on('error', (err) => {
          clearInterval(progressInterval);
          stream.end();
          reject(err);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download timed out'));
      });

      req.end();
    });
  }
}
