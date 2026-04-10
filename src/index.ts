/**
 * ytgrab - YouTube video downloader for Node.js
 * Ported from yt-dlp (Python)
 *
 * @example
 * ```ts
 * import { YtGrab } from 'ytgrab';
 *
 * const ytgrab = new YtGrab();
 *
 * // Get video info
 * const info = await ytgrab.getInfo('https://youtube.com/watch?v=dQw4w9WgXcQ');
 * console.log(info.title, info.formats);
 *
 * // Download video
 * await ytgrab.download('https://youtube.com/watch?v=dQw4w9WgXcQ');
 *
 * // Download with options
 * const yt = new YtGrab({
 *   format: 'best',
 *   output: '%(title)s.%(ext)s',
 *   extractAudio: true,
 *   audioFormat: 'mp3',
 * });
 * await yt.download('https://youtube.com/watch?v=dQw4w9WgXcQ');
 * ```
 */

export { YtGrab } from './ytgrab.js';
export { YoutubeIE, YoutubePlaylistIE, YoutubeSearchIE } from './extractor/youtube.js';
export { InfoExtractor } from './extractor/common.js';
export { FileDownloader, HttpFD, HlsFD, getSuitableDownloader } from './downloader/index.js';
export {
  FFmpegPostProcessor, FFmpegExtractAudioPP, FFmpegVideoConvertorPP,
  FFmpegMergerPP, FFmpegMetadataPP, FFmpegEmbedSubtitlePP,
} from './postprocessor/ffmpeg.js';
export { PostProcessor } from './postprocessor/common.js';

export type {
  InfoDict, VideoFormat, Fragment, Thumbnail, Subtitle, Chapter,
  DownloadProgress, ProgressHook, PostprocessorHook, YtGrabOptions,
} from './types.js';

export {
  traverseObj, tryGet,
  intOrNone, floatOrNone, strOrNone, urlOrNone,
  sanitizeFilename, formatBytes, parseDuration, parseFilesize,
  unescapeHTML, cleanHTML, determineExt, mimetypeToExt,
  ExtractorError, DownloadError, GeoRestrictedError, UnsupportedError,
} from './utils/index.js';
