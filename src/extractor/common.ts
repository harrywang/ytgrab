/**
 * Base InfoExtractor class - ported from yt_dlp/extractor/common.py
 *
 * All extractors extend this class and implement _realExtract().
 */

import { makeRequest, type RequestOptions, type Response } from '../networking/index.js';
import {
  ExtractorError, RegexNotFoundError,
  unescapeHTML, intOrNone, floatOrNone,
  jsToJson, stripJsonp, determineExt, mimetypeToExt,
} from '../utils/index.js';
import type { InfoDict, VideoFormat, Subtitle, Thumbnail } from '../types.js';

export interface ExtractorMatch {
  ie: InfoExtractor;
  match: RegExpMatchArray;
}

export abstract class InfoExtractor {
  abstract readonly IE_NAME: string;
  abstract readonly _VALID_URL: RegExp;

  protected _downloader: any = null;
  protected _httpHeaders: Record<string, string> = {};

  setDownloader(downloader: any): void {
    this._downloader = downloader;
    if (downloader?.params?.httpHeaders) {
      this._httpHeaders = downloader.params.httpHeaders;
    }
  }

  suitable(url: string): boolean {
    return this._VALID_URL.test(url);
  }

  matchUrl(url: string): RegExpMatchArray | null {
    return url.match(this._VALID_URL);
  }

  async extract(url: string): Promise<InfoDict> {
    const match = this.matchUrl(url);
    if (!match) {
      throw new ExtractorError(`URL not suitable for ${this.IE_NAME}: ${url}`);
    }
    try {
      const result = await this._realExtract(url, match);
      if (!result.webpage_url) result.webpage_url = url;
      return result;
    } catch (err) {
      if (err instanceof ExtractorError) throw err;
      throw new ExtractorError(
        `${this.IE_NAME}: ${(err as Error).message}`,
        err as Error,
      );
    }
  }

  protected abstract _realExtract(url: string, match: RegExpMatchArray): Promise<InfoDict>;

  // --- HTTP helpers ---

  protected async _downloadWebpage(
    url: string,
    videoId: string,
    note: string = 'Downloading webpage',
    options: RequestOptions = {},
  ): Promise<string> {
    this._log(note, videoId);
    const headers = { ...this._httpHeaders, ...options.headers };
    const resp = await makeRequest(url, { ...options, headers });
    if (resp.status >= 400) {
      throw new ExtractorError(`HTTP Error ${resp.status}: ${url}`);
    }
    return resp.text();
  }

  protected async _downloadJson(
    url: string,
    videoId: string,
    note: string = 'Downloading JSON',
    options: RequestOptions = {},
    fatal: boolean = true,
  ): Promise<unknown> {
    const webpage = await this._downloadWebpage(url, videoId, note, options);
    return this._parseJson(webpage, videoId, fatal);
  }

  protected async _requestWebpage(
    url: string,
    videoId: string,
    note: string = 'Requesting',
    options: RequestOptions = {},
  ): Promise<Response> {
    this._log(note, videoId);
    const headers = { ...this._httpHeaders, ...options.headers };
    return makeRequest(url, { ...options, headers });
  }

  // --- Parsing helpers ---

  protected _parseJson(jsonStr: string, videoId: string, fatal: boolean = true): unknown {
    try {
      return JSON.parse(jsonStr);
    } catch {
      try {
        return JSON.parse(jsToJson(jsonStr));
      } catch (err) {
        if (fatal) throw new ExtractorError(`Failed to parse JSON for ${videoId}: ${(err as Error).message}`);
        return null;
      }
    }
  }

  protected _searchRegex(
    patterns: RegExp | RegExp[],
    str: string,
    name: string,
    defaultVal?: string,
    fatal: boolean = true,
    group?: number | string,
  ): string | null {
    const patternList = Array.isArray(patterns) ? patterns : [patterns];

    for (const pattern of patternList) {
      const match = str.match(pattern);
      if (match) {
        if (group !== undefined) {
          const val = typeof group === 'number' ? match[group] : match[Number(group)];
          return val ?? defaultVal ?? null;
        }
        return match[1] ?? match[0];
      }
    }

    if (defaultVal !== undefined) return defaultVal;
    if (fatal) throw new RegexNotFoundError(name);
    return null;
  }

  protected _htmlSearchRegex(
    patterns: RegExp | RegExp[],
    html: string,
    name: string,
    defaultVal?: string,
    fatal: boolean = true,
    group?: number,
  ): string | null {
    const result = this._searchRegex(patterns, html, name, defaultVal, fatal, group);
    return result ? unescapeHTML(result) : result;
  }

  protected _htmlSearchMeta(
    names: string | string[],
    html: string,
    displayName?: string,
    fatal: boolean = false,
  ): string | null {
    const nameList = Array.isArray(names) ? names : [names];
    for (const name of nameList) {
      const patterns = [
        new RegExp(`<meta[^>]+(?:name|property|http-equiv)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property|http-equiv)=["']${name}["']`, 'i'),
      ];
      const result = this._searchRegex(patterns, html, displayName || name, undefined, false);
      if (result) return unescapeHTML(result);
    }
    if (fatal) throw new RegexNotFoundError(displayName || String(nameList[0]));
    return null;
  }

  protected _ogSearchProperty(prop: string, html: string, fatal: boolean = true): string | null {
    return this._htmlSearchMeta(`og:${prop}`, html, `og:${prop}`, fatal);
  }

  protected _ogSearchTitle(html: string): string | null {
    return this._ogSearchProperty('title', html, false);
  }

  protected _ogSearchDescription(html: string): string | null {
    return this._ogSearchProperty('description', html, false);
  }

  protected _ogSearchThumbnail(html: string): string | null {
    return this._ogSearchProperty('image', html, false);
  }

  protected _htmlExtractTitle(html: string): string | null {
    return this._htmlSearchRegex(/<title[^>]*>([^<]+)<\/title>/i, html, 'title', undefined, false);
  }

  // --- Format helpers ---

  protected async _extractM3u8FormatsAndSubtitles(
    m3u8Url: string,
    videoId: string,
    ext: string = 'mp4',
    preference?: number,
    note: string = 'Downloading m3u8 manifest',
  ): Promise<{ formats: VideoFormat[]; subtitles: Record<string, Subtitle[]> }> {
    const manifest = await this._downloadWebpage(m3u8Url, videoId, note);
    const formats: VideoFormat[] = [];
    const subtitles: Record<string, Subtitle[]> = {};

    // Parse master playlist
    const lines = manifest.split('\n');
    let currentStreamInfo: Record<string, string> = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        currentStreamInfo = this._parseM3u8Attributes(line.slice('#EXT-X-STREAM-INF:'.length));
      } else if (line.startsWith('#EXT-X-MEDIA:')) {
        const attrs = this._parseM3u8Attributes(line.slice('#EXT-X-MEDIA:'.length));
        if (attrs['TYPE'] === 'SUBTITLES' && attrs['URI']) {
          const lang = attrs['LANGUAGE'] || 'und';
          if (!subtitles[lang]) subtitles[lang] = [];
          subtitles[lang].push({
            url: new URL(attrs['URI'], m3u8Url).toString(),
            ext: 'vtt',
            name: attrs['NAME'],
          });
        }
      } else if (line && !line.startsWith('#')) {
        // URL line
        const streamUrl = new URL(line, m3u8Url).toString();
        const bandwidth = intOrNone(currentStreamInfo['BANDWIDTH']);
        const resolution = currentStreamInfo['RESOLUTION'];
        let width: number | undefined;
        let height: number | undefined;
        if (resolution) {
          const [w, h] = resolution.split('x');
          width = parseInt(w, 10) || undefined;
          height = parseInt(h, 10) || undefined;
        }
        const codecs = currentStreamInfo['CODECS'] || '';
        const format: VideoFormat = {
          format_id: `hls-${bandwidth || formats.length}`,
          url: streamUrl,
          manifest_url: m3u8Url,
          ext,
          protocol: 'm3u8_native',
          tbr: bandwidth ? Math.round(bandwidth / 1000) : undefined,
          width,
          height,
          vcodec: codecs.split(',').find(c => /^(avc|hev|hvc|vp|av01)/i.test(c.trim()))?.trim(),
          acodec: codecs.split(',').find(c => /^(mp4a|opus|vorb|flac|ac-3)/i.test(c.trim()))?.trim(),
        };
        if (preference !== undefined) format.preference = preference;
        formats.push(format);
        currentStreamInfo = {};
      }
    }

    // If no stream-inf found, this is a media playlist itself
    if (formats.length === 0 && manifest.includes('#EXTINF:')) {
      formats.push({
        format_id: 'hls',
        url: m3u8Url,
        ext,
        protocol: 'm3u8_native',
      });
    }

    return { formats, subtitles };
  }

  protected async _extractMpdFormatsAndSubtitles(
    mpdUrl: string,
    videoId: string,
    note: string = 'Downloading MPD manifest',
  ): Promise<{ formats: VideoFormat[]; subtitles: Record<string, Subtitle[]> }> {
    const manifest = await this._downloadWebpage(mpdUrl, videoId, note);
    const formats: VideoFormat[] = [];
    const subtitles: Record<string, Subtitle[]> = {};

    // Basic MPD parsing — handles common YouTube DASH manifest structure
    const periodMatch = manifest.match(/<Period[\s\S]*?<\/Period>/g);
    if (!periodMatch) return { formats, subtitles };

    for (const period of periodMatch) {
      const adaptationSets = period.match(/<AdaptationSet[\s\S]*?<\/AdaptationSet>/g) || [];

      for (const adaptationSet of adaptationSets) {
        const asAttrs = this._parseXmlAttributes(adaptationSet);
        const mimeType = asAttrs['mimeType'] || '';
        const contentType = asAttrs['contentType'] || '';
        const lang = asAttrs['lang'];

        // Check for subtitles
        if (contentType === 'text' || mimeType.startsWith('text/')) {
          const repMatches = adaptationSet.match(/<Representation[\s\S]*?(?:\/>|<\/Representation>)/g) || [];
          for (const rep of repMatches) {
            const repAttrs = this._parseXmlAttributes(rep);
            const baseUrlMatch = rep.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/);
            if (baseUrlMatch) {
              const subLang = lang || 'und';
              if (!subtitles[subLang]) subtitles[subLang] = [];
              subtitles[subLang].push({
                url: new URL(baseUrlMatch[1], mpdUrl).toString(),
                ext: mimetypeToExt(mimeType) || 'vtt',
              });
            }
          }
          continue;
        }

        const repMatches = adaptationSet.match(/<Representation[\s\S]*?(?:\/>|<\/Representation>)/g) || [];
        for (const rep of repMatches) {
          const repAttrs = this._parseXmlAttributes(rep);
          const combinedMime = repAttrs['mimeType'] || mimeType;
          const ext = mimetypeToExt(combinedMime) || 'mp4';
          const bandwidth = intOrNone(repAttrs['bandwidth']);
          const width = intOrNone(repAttrs['width']);
          const height = intOrNone(repAttrs['height']);
          const codecs = repAttrs['codecs'] || asAttrs['codecs'] || '';
          const id = repAttrs['id'] || '';

          const baseUrlMatch = rep.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/) ||
                               adaptationSet.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/);
          const segUrl = baseUrlMatch ? new URL(baseUrlMatch[1], mpdUrl).toString() : mpdUrl;

          const isVideo = combinedMime.startsWith('video/') || contentType === 'video';
          const isAudio = combinedMime.startsWith('audio/') || contentType === 'audio';

          const format: VideoFormat = {
            format_id: `dash-${id || formats.length}`,
            url: segUrl,
            manifest_url: mpdUrl,
            ext,
            protocol: 'http_dash_segments',
            tbr: bandwidth ? Math.round(bandwidth / 1000) : undefined,
            width: isVideo ? width ?? undefined : undefined,
            height: isVideo ? height ?? undefined : undefined,
            vcodec: isVideo ? codecs || undefined : 'none',
            acodec: isAudio ? codecs || undefined : (isVideo ? 'none' : undefined),
            asr: intOrNone(repAttrs['audioSamplingRate']) ?? undefined,
          };
          formats.push(format);
        }
      }
    }

    return { formats, subtitles };
  }

  private _parseM3u8Attributes(line: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([A-Z0-9-]+)=(?:"([^"]*)"|([\w./:-]+))/g;
    let match;
    while ((match = re.exec(line)) !== null) {
      attrs[match[1]] = match[2] ?? match[3];
    }
    return attrs;
  }

  private _parseXmlAttributes(tag: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const firstTag = tag.match(/<\w+([^>]*)>/)?.[1] || '';
    const re = /(\w+)="([^"]*)"/g;
    let match;
    while ((match = re.exec(firstTag)) !== null) {
      attrs[match[1]] = match[2];
    }
    return attrs;
  }

  // --- Sorting ---

  protected _sortFormats(formats: VideoFormat[]): void {
    formats.sort((a, b) => {
      const getScore = (f: VideoFormat): number => {
        let score = 0;
        score += (f.height || 0) * 10000;
        score += (f.tbr || 0);
        score += (f.preference || 0) * 100000;
        if (f.vcodec && f.vcodec !== 'none') score += 1000000;
        if (f.acodec && f.acodec !== 'none') score += 500000;
        return score;
      };
      return getScore(a) - getScore(b);
    });
  }

  // --- Logging ---

  protected _log(msg: string, videoId?: string): void {
    const prefix = videoId ? `[${this.IE_NAME}] ${videoId}: ` : `[${this.IE_NAME}] `;
    if (this._downloader?.params?.quiet) return;
    if (this._downloader) {
      this._downloader.toScreen(`${prefix}${msg}`);
    } else {
      console.log(`${prefix}${msg}`);
    }
  }

  protected _warn(msg: string, videoId?: string): void {
    const prefix = videoId ? `[${this.IE_NAME}] ${videoId}: ` : `[${this.IE_NAME}] `;
    if (this._downloader) {
      this._downloader.reportWarning(`${prefix}${msg}`);
    } else {
      console.warn(`WARNING: ${prefix}${msg}`);
    }
  }
}
