/**
 * Downloader registry - selects appropriate downloader based on protocol.
 */

export { FileDownloader } from './common.js';
export { HttpFD } from './http.js';
export { HlsFD } from './hls.js';

import { FileDownloader } from './common.js';
import { HttpFD } from './http.js';
import { HlsFD } from './hls.js';
import type { VideoFormat } from '../types.js';

export function getSuitableDownloader(format: VideoFormat, ydl: any): FileDownloader {
  const protocol = format.protocol || 'https';

  if (protocol === 'm3u8' || protocol === 'm3u8_native') {
    return new HlsFD(ydl);
  }

  // Default to HTTP for https, http, and http_dash_segments
  return new HttpFD(ydl);
}
