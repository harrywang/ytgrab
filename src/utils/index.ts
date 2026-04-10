/**
 * Core utility functions ported from yt_dlp/utils/_utils.py
 */

export { traverseObj, tryGet } from './traversal.js';

// --- Type coercion helpers ---

export function intOrNone(v: unknown, scale: number = 1, defaultVal: number | null = null): number | null {
  if (v === null || v === undefined || v === '') return defaultVal;
  try {
    const num = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (isNaN(num)) return defaultVal;
    return Math.round(num / scale);
  } catch {
    return defaultVal;
  }
}

export function floatOrNone(v: unknown, scale: number = 1, defaultVal: number | null = null): number | null {
  if (v === null || v === undefined || v === '') return defaultVal;
  try {
    const num = typeof v === 'number' ? v : parseFloat(String(v));
    if (isNaN(num)) return defaultVal;
    return num / scale;
  } catch {
    return defaultVal;
  }
}

export function strOrNone(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s || null;
}

export function urlOrNone(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('//')) {
    return trimmed.startsWith('//') ? `https:${trimmed}` : null;
  }
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  return null;
}

export function boolOrNone(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  return null;
}

// --- String helpers ---

export function unescapeHTML(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export function cleanHTML(html: string | null | undefined): string {
  if (!html) return '';
  let text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
  return unescapeHTML(text);
}

export function stripOrNone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const stripped = v.trim();
  return stripped || null;
}

// --- Filename helpers ---

const FILENAME_UNSAFE_RE = /[<>:"/\\|?*\x00-\x1f]/g;
const FILENAME_RESTRICTED_RE = /[^\w.\-]/g;

export function sanitizeFilename(s: string, restricted: boolean = false): string {
  let result = s.replace(FILENAME_UNSAFE_RE, '_');
  if (restricted) {
    result = result.replace(FILENAME_RESTRICTED_RE, '_');
  }
  // Remove leading/trailing dots and spaces
  result = result.replace(/^[\s.]+|[\s.]+$/g, '');
  // Collapse multiple underscores
  result = result.replace(/_+/g, '_');
  return result || '_';
}

export function determineExt(url: string, defaultExt: string = 'unknown_video'): string {
  const parsed = url.split('?')[0].split('#')[0];
  const lastDot = parsed.lastIndexOf('.');
  if (lastDot === -1) return defaultExt;
  const ext = parsed.slice(lastDot + 1).toLowerCase();
  if (ext.length > 10 || ext.length === 0) return defaultExt;
  return ext;
}

// --- Date/time helpers ---

export function parseDuration(s: unknown): number | null {
  if (typeof s === 'number') return s;
  if (typeof s !== 'string' || !s.trim()) return null;

  const str = s.trim();

  // HH:MM:SS or MM:SS or SS
  const hmsMatch = str.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/);
  if (hmsMatch) {
    const hours = parseInt(hmsMatch[1] || '0', 10);
    const mins = parseInt(hmsMatch[2], 10);
    const secs = parseInt(hmsMatch[3], 10);
    const frac = hmsMatch[4] ? parseFloat(`0.${hmsMatch[4]}`) : 0;
    return hours * 3600 + mins * 60 + secs + frac;
  }

  // ISO 8601 duration PT1H2M3S
  const isoMatch = str.match(/^P?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (isoMatch && (isoMatch[1] || isoMatch[2] || isoMatch[3])) {
    const hours = parseInt(isoMatch[1] || '0', 10);
    const mins = parseInt(isoMatch[2] || '0', 10);
    const secs = parseFloat(isoMatch[3] || '0');
    return hours * 3600 + mins * 60 + secs;
  }

  // Plain seconds
  const secMatch = str.match(/^(\d+(?:\.\d+)?)$/);
  if (secMatch) return parseFloat(secMatch[1]);

  return null;
}

export function unifiedStrdate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/[,\s]+/g, ' ').trim();

  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
  return null;
}

export function unifiedTimestamp(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const cleaned = dateStr.replace(/[,\s]+/g, ' ').trim();
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) {
    return Math.floor(d.getTime() / 1000);
  }
  return null;
}

// --- Size formatting ---

const SIZE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return 'N/A';
  let size = bytes;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < SIZE_UNITS.length - 1) {
    size /= 1024;
    unitIdx++;
  }
  return `${size.toFixed(2)} ${SIZE_UNITS[unitIdx]}`;
}

export function parseFilesize(s: string | null | undefined): number | null {
  if (!s) return null;
  const match = s.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)?$/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  const multipliers: Record<string, number> = {
    'B': 1, 'KB': 1000, 'KIB': 1024,
    'MB': 1e6, 'MIB': 1024 ** 2,
    'GB': 1e9, 'GIB': 1024 ** 3,
    'TB': 1e12, 'TIB': 1024 ** 4,
  };
  return Math.round(num * (multipliers[unit] || 1));
}

// --- MIME type helpers ---

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-flv': 'flv',
  'video/3gpp': '3gp', 'video/x-matroska': 'mkv', 'video/quicktime': 'mov',
  'video/x-msvideo': 'avi', 'video/x-ms-wmv': 'wmv',
  'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/webm': 'weba',
  'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/flac': 'flac',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac',
  'text/vtt': 'vtt', 'application/x-mpegURL': 'm3u8',
  'application/dash+xml': 'mpd', 'text/xml': 'xml',
  'application/ttml+xml': 'ttml',
};

export function mimetypeToExt(mt: string | null | undefined): string | null {
  if (!mt) return null;
  const base = mt.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[base] || null;
}

// --- JSON helpers ---

export function jsToJson(code: string): string {
  // Convert JavaScript object notation to valid JSON
  let result = code;
  // Remove single-line comments
  result = result.replace(/\/\/[^\n]*/g, '');
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  // Replace single quotes with double quotes (basic — doesn't handle escaped quotes in all cases)
  result = result.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
  // Add quotes to unquoted keys
  result = result.replace(/(\{|,)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
  // Remove trailing commas
  result = result.replace(/,\s*([\]}])/g, '$1');
  return result;
}

export function stripJsonp(code: string): string {
  return code.replace(/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(\s*/, '').replace(/\s*\)\s*;?\s*$/, '');
}

// --- HTML extraction helpers ---

export function getElementByID(id: string, html: string): string | null {
  const re = new RegExp(`<[^>]+\\bid\\s*=\\s*["']${escapeRegex(id)}["'][^>]*>([\\s\\S]*?)</`, 'i');
  const match = html.match(re);
  return match ? match[1] : null;
}

export function getElementByClass(className: string, html: string): string | null {
  const re = new RegExp(
    `<[^>]+\\bclass\\s*=\\s*["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>([\\s\\S]*?)</`,
    'i'
  );
  const match = html.match(re);
  return match ? match[1] : null;
}

export function extractAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /\b([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let match;
  while ((match = re.exec(tag)) !== null) {
    attrs[match[1]] = unescapeHTML(match[2] ?? match[3] ?? match[4]);
  }
  return attrs;
}

// --- Codec parsing ---

export function parseCodecs(codecsStr: string | null | undefined): { vcodec?: string; acodec?: string } {
  if (!codecsStr) return {};
  const codecs = codecsStr.split(',').map(c => c.trim());
  const result: { vcodec?: string; acodec?: string } = {};

  for (const codec of codecs) {
    if (/^(avc|hev|hvc|vp[089]|av01|theora)/i.test(codec)) {
      result.vcodec = codec;
    } else if (/^(mp4a|opus|vorb|flac|ac-3|ec-3|dtse|mp3|aac)/i.test(codec)) {
      result.acodec = codec;
    }
  }
  return result;
}

// --- Miscellaneous ---

export function variadic<T>(x: T | T[]): T[] {
  return Array.isArray(x) ? x : [x];
}

export function filterDict<V>(
  dct: Record<string, V>,
  condition: (key: string, val: V) => boolean = (_, v) => v !== null && v !== undefined
): Record<string, V> {
  const result: Record<string, V> = {};
  for (const [key, val] of Object.entries(dct)) {
    if (condition(key, val)) result[key] = val;
  }
  return result;
}

export function mergeDicts(...dicts: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const d of dicts) {
    for (const [key, val] of Object.entries(d)) {
      if (val !== null && val !== undefined && !(key in result && result[key] !== null && result[key] !== undefined)) {
        result[key] = val;
      }
    }
  }
  return result;
}

export function qualities(qualityIds: string[]): (id: string) => number {
  return (id: string) => {
    const idx = qualityIds.indexOf(id);
    return idx;
  };
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function orderedSet<T>(iterable: T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const item of iterable) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

export function formatField(
  obj: Record<string, unknown> | unknown,
  field?: string,
  template: string = '%s',
  defaultVal: string = ''
): string {
  let val: unknown;
  if (field) {
    val = typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>)[field] : undefined;
  } else {
    val = obj;
  }
  if (val === null || val === undefined || val === '') return defaultVal;
  return template.replace('%s', String(val));
}

export function removeStart(s: string, start: string): string {
  return s.startsWith(start) ? s.slice(start.length) : s;
}

export function removeEnd(s: string, end: string): string {
  return s.endsWith(end) ? s.slice(0, -end.length) : s;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ExtractorError extends Error {
  constructor(message: string, public cause_?: Error, public video_id?: string) {
    super(message);
    this.name = 'ExtractorError';
  }
}

export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

export class GeoRestrictedError extends ExtractorError {
  constructor(message: string = 'This content is not available in your region') {
    super(message);
    this.name = 'GeoRestrictedError';
  }
}

export class UnsupportedError extends ExtractorError {
  constructor(url: string) {
    super(`Unsupported URL: ${url}`);
    this.name = 'UnsupportedError';
  }
}

export class RegexNotFoundError extends ExtractorError {
  constructor(name: string) {
    super(`Unable to extract ${name}`);
    this.name = 'RegexNotFoundError';
  }
}
