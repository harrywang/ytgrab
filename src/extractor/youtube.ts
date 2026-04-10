/**
 * YouTube extractor - ported from yt_dlp/extractor/youtube/
 *
 * Extracts video info, formats, subtitles from YouTube URLs
 * using the InnerTube API.
 */

import { InfoExtractor } from './common.js';
import { makeRequest } from '../networking/index.js';
import {
  intOrNone, floatOrNone, strOrNone, urlOrNone,
  unescapeHTML, cleanHTML, parseDuration, unifiedTimestamp,
  jsToJson, traverseObj, tryGet, ExtractorError,
  sanitizeFilename, parseCodecs, orderedSet, filterDict,
} from '../utils/index.js';
import type { InfoDict, VideoFormat, Subtitle, Thumbnail, Chapter } from '../types.js';
import { extractPlayerUrl, solveNChallenge } from './nsig.js';
import { makeRequest as nsigMakeRequest } from '../networking/index.js';

// --- InnerTube Client Definitions ---

interface InnertubeClient {
  INNERTUBE_CONTEXT: {
    client: Record<string, unknown>;
  };
  INNERTUBE_CONTEXT_CLIENT_NAME: number;
  INNERTUBE_HOST?: string;
  REQUIRE_JS_PLAYER?: boolean;
  SUPPORTS_COOKIES?: boolean;
}

const INNERTUBE_CLIENTS: Record<string, InnertubeClient> = {
  web: {
    INNERTUBE_CONTEXT: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20260114.08.00',
      },
    },
    INNERTUBE_CONTEXT_CLIENT_NAME: 1,
    SUPPORTS_COOKIES: true,
  },
  web_safari: {
    INNERTUBE_CONTEXT: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20260114.08.00',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)',
      },
    },
    INNERTUBE_CONTEXT_CLIENT_NAME: 1,
    SUPPORTS_COOKIES: true,
  },
  web_embedded: {
    INNERTUBE_CONTEXT: {
      client: {
        clientName: 'WEB_EMBEDDED_PLAYER',
        clientVersion: '1.20260115.01.00',
      },
    },
    INNERTUBE_CONTEXT_CLIENT_NAME: 56,
    SUPPORTS_COOKIES: true,
  },
  android_vr: {
    INNERTUBE_CONTEXT: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.65.10',
        deviceMake: 'Oculus',
        deviceModel: 'Quest 3',
        androidSdkVersion: 32,
        userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
        osName: 'Android',
        osVersion: '12L',
      },
    },
    INNERTUBE_CONTEXT_CLIENT_NAME: 28,
    REQUIRE_JS_PLAYER: false,
  },
  ios: {
    INNERTUBE_CONTEXT: {
      client: {
        clientName: 'IOS',
        clientVersion: '21.02.3',
        deviceMake: 'Apple',
        deviceModel: 'iPhone16,2',
        userAgent: 'com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
        osName: 'iPhone',
        osVersion: '18.3.2.22D82',
      },
    },
    INNERTUBE_CONTEXT_CLIENT_NAME: 5,
    REQUIRE_JS_PLAYER: false,
  },
  mweb: {
    INNERTUBE_CONTEXT: {
      client: {
        clientName: 'MWEB',
        clientVersion: '2.20260115.01.00',
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)',
      },
    },
    INNERTUBE_CONTEXT_CLIENT_NAME: 2,
    SUPPORTS_COOKIES: true,
  },
  tv: {
    INNERTUBE_CONTEXT: {
      client: {
        clientName: 'TVHTML5',
        clientVersion: '7.20260114.12.00',
        userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)',
      },
    },
    INNERTUBE_CONTEXT_CLIENT_NAME: 7,
    SUPPORTS_COOKIES: true,
  },
};

const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_HOST = 'www.youtube.com';

// YouTube itag quality map
const ITAG_QUALITIES: Record<number, { height?: number; width?: number; fps?: number; abr?: number; vcodec?: string; acodec?: string; ext?: string }> = {
  // Video+Audio
  18: { height: 360, ext: 'mp4' },
  22: { height: 720, ext: 'mp4' },
  // Video only
  134: { height: 360, ext: 'mp4' },
  135: { height: 480, ext: 'mp4' },
  136: { height: 720, ext: 'mp4' },
  137: { height: 1080, ext: 'mp4' },
  160: { height: 144, ext: 'mp4' },
  298: { height: 720, fps: 60, ext: 'mp4' },
  299: { height: 1080, fps: 60, ext: 'mp4' },
  264: { height: 1440, ext: 'mp4' },
  266: { height: 2160, ext: 'mp4' },
  // VP9 video only
  243: { height: 360, ext: 'webm' },
  244: { height: 480, ext: 'webm' },
  247: { height: 720, ext: 'webm' },
  248: { height: 1080, ext: 'webm' },
  271: { height: 1440, ext: 'webm' },
  313: { height: 2160, ext: 'webm' },
  302: { height: 720, fps: 60, ext: 'webm' },
  303: { height: 1080, fps: 60, ext: 'webm' },
  308: { height: 1440, fps: 60, ext: 'webm' },
  315: { height: 2160, fps: 60, ext: 'webm' },
  // AV1 video only
  394: { height: 144, ext: 'mp4' },
  395: { height: 240, ext: 'mp4' },
  396: { height: 360, ext: 'mp4' },
  397: { height: 480, ext: 'mp4' },
  398: { height: 720, ext: 'mp4' },
  399: { height: 1080, ext: 'mp4' },
  400: { height: 1440, ext: 'mp4' },
  401: { height: 2160, ext: 'mp4' },
  571: { height: 4320, ext: 'mp4' },
  // Audio only
  139: { abr: 48, acodec: 'mp4a.40.5', ext: 'm4a' },
  140: { abr: 128, acodec: 'mp4a.40.2', ext: 'm4a' },
  141: { abr: 256, acodec: 'mp4a.40.2', ext: 'm4a' },
  171: { abr: 128, acodec: 'vorbis', ext: 'webm' },
  172: { abr: 256, acodec: 'vorbis', ext: 'webm' },
  249: { abr: 50, acodec: 'opus', ext: 'webm' },
  250: { abr: 70, acodec: 'opus', ext: 'webm' },
  251: { abr: 160, acodec: 'opus', ext: 'webm' },
};

// Subtitle formats
const SUBTITLE_FORMATS = ['json3', 'srv1', 'srv2', 'srv3', 'ttml', 'srt', 'vtt'] as const;

export class YoutubeIE extends InfoExtractor {
  readonly IE_NAME = 'youtube';

  readonly _VALID_URL = /^(?:https?:\/\/)?(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?.*?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([0-9A-Za-z_-]{11})/;

  private _defaultClients: string[] = ['android_vr', 'web_safari'];

  protected async _realExtract(url: string, match: RegExpMatchArray): Promise<InfoDict> {
    const videoId = match[1];

    // Step 1: Try to get initial data from webpage
    let webpage: string | null = null;
    let ytcfg: Record<string, unknown> = {};
    let initialData: Record<string, unknown> = {};
    let playerResponse: Record<string, unknown> | null = null;

    try {
      webpage = await this._downloadWebpage(
        `https://www.youtube.com/watch?v=${videoId}`,
        videoId,
        'Downloading webpage',
      );
      ytcfg = this._extractYtcfg(webpage, videoId);
      initialData = this._extractInitialData(webpage, videoId);
      playerResponse = this._extractInitialPlayerResponse(webpage, videoId);
    } catch (err) {
      this._warn(`Failed to download webpage: ${(err as Error).message}`, videoId);
    }

    // Extract player URL and signatureTimestamp for API calls
    const earlyPlayerUrl: string | null = webpage ? extractPlayerUrl(webpage) : null;
    let signatureTimestamp: number | null = null;

    if (earlyPlayerUrl) {
      try {
        const playerResp = await nsigMakeRequest(earlyPlayerUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
        });
        const playerJs = playerResp.text();
        const stsMatch = playerJs.match(/(?:signatureTimestamp|sts)\s*:\s*(\d{5})/);
        if (stsMatch) {
          signatureTimestamp = parseInt(stsMatch[1]);
          this._log(`Extracted signatureTimestamp: ${signatureTimestamp}`, videoId);
        }
      } catch { /* ignore */ }
    }

    // Step 2: Fetch player response(s) via InnerTube API
    // Track which client produced each response for correct UA headers
    const playerResponses: { response: Record<string, unknown>; clientName: string }[] = [];
    if (playerResponse) {
      playerResponses.push({ response: playerResponse, clientName: 'web' });
    }

    for (const clientName of this._defaultClients) {
      try {
        const query: Record<string, unknown> = {
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
          playbackContext: {
            contentPlaybackContext: {
              html5Preference: 'HTML5_PREF_WANTS',
              ...(signatureTimestamp ? { signatureTimestamp } : {}),
            },
          },
        };
        const response = await this._callApi('player', videoId, clientName, query);
        if (response && typeof response === 'object') {
          playerResponses.push({ response: response as Record<string, unknown>, clientName });
        }
      } catch (err) {
        this._warn(`${clientName} client failed: ${(err as Error).message}`, videoId);
      }
    }

    if (playerResponses.length === 0) {
      throw new ExtractorError(`Failed to extract player response for ${videoId}`);
    }

    // Step 3: Extract video details from best response
    const responses = playerResponses.map(p => p.response);
    const videoDetails = this._extractVideoDetails(responses, initialData);
    const microformat = this._extractMicroformat(responses);

    // Check playability
    const playability = this._checkPlayability(responses, videoId);
    if (playability.error) {
      this._warn(playability.error, videoId);
    }

    // Step 4: Extract formats from all responses (with client-specific UA)
    const allFormats: VideoFormat[] = [];
    const allSubtitles: Record<string, Subtitle[]> = {};

    for (const { response: pr, clientName } of playerResponses) {
      const { formats, subtitles } = this._extractFormats(pr, videoId, clientName);
      allFormats.push(...formats);
      this._mergeSubtitles(allSubtitles, subtitles);
    }

    // Extract subtitles/captions
    for (const { response: pr } of playerResponses) {
      const { subtitles, automaticCaptions } = this._extractCaptions(pr, videoId);
      this._mergeSubtitles(allSubtitles, subtitles);
      // Store auto-captions separately (will merge into result)
      if (Object.keys(automaticCaptions).length > 0) {
        (videoDetails as any)._automatic_captions = automaticCaptions;
      }
    }

    // Deduplicate formats
    const seenFormatIds = new Set<string>();
    const uniqueFormats = allFormats.filter(f => {
      const key = `${f.format_id}-${f.height || 0}-${f.tbr || 0}-${f.url?.slice(0, 100)}`;
      if (seenFormatIds.has(key)) return false;
      seenFormatIds.add(key);
      return true;
    });

    this._sortFormats(uniqueFormats);

    // Step 4b: Solve n-parameter challenges for format URLs
    const playerUrl = webpage ? extractPlayerUrl(webpage) : null;
    if (playerUrl) {
      this._log('Solving n-parameter challenges', videoId);
      for (let i = 0; i < uniqueFormats.length; i++) {
        const fmt = uniqueFormats[i];
        if (fmt.url) {
          try {
            uniqueFormats[i].url = await solveNChallenge(fmt.url, playerUrl);
          } catch {
            this._warn(`Failed to solve n-challenge for format ${fmt.format_id}`, videoId);
          }
        }
      }
    } else {
      this._warn('Could not find player URL - downloads may be throttled or fail', videoId);
    }

    // Step 5: Extract thumbnails
    const thumbnails = this._extractThumbnails(responses, videoId);

    // Step 6: Extract chapters
    const chapters = this._extractChapters(initialData, videoDetails.description || '');

    // Step 7: Determine live status
    const liveStatus = this._extractLiveStatus(videoDetails, responses);

    // Build the result
    const title = videoDetails.title || this._extractTitle(webpage, initialData);
    const description = videoDetails.description || '';
    const duration = videoDetails.duration;
    const uploadDate = microformat.uploadDate;
    const timestamp = microformat.timestamp;

    const result: InfoDict = {
      id: videoId,
      title,
      description,
      upload_date: uploadDate ?? undefined,
      timestamp: timestamp ?? undefined,
      uploader: videoDetails.uploader ?? undefined,
      uploader_id: videoDetails.uploaderId ?? undefined,
      uploader_url: videoDetails.uploaderUrl ?? undefined,
      channel: videoDetails.channel ?? undefined,
      channel_id: videoDetails.channelId ?? undefined,
      channel_url: videoDetails.channelId ? `https://www.youtube.com/channel/${videoDetails.channelId}` : undefined,
      channel_follower_count: videoDetails.channelFollowerCount ?? undefined,
      duration,
      view_count: videoDetails.viewCount ?? undefined,
      like_count: videoDetails.likeCount ?? undefined,
      age_limit: videoDetails.ageLimit,
      webpage_url: `https://www.youtube.com/watch?v=${videoId}`,
      categories: videoDetails.categories,
      tags: videoDetails.tags,
      thumbnails,
      subtitles: allSubtitles,
      automatic_captions: (videoDetails as any)._automatic_captions || {},
      formats: uniqueFormats,
      chapters: chapters.length > 0 ? chapters : undefined,
      live_status: liveStatus,
      availability: videoDetails.availability,
    };

    return result;
  }

  // --- InnerTube API ---

  private async _callApi(
    endpoint: string,
    videoId: string,
    clientName: string,
    query: Record<string, unknown>,
  ): Promise<unknown> {
    const client = INNERTUBE_CLIENTS[clientName];
    if (!client) {
      throw new ExtractorError(`Unknown client: ${clientName}`);
    }

    const context = {
      client: {
        ...client.INNERTUBE_CONTEXT.client,
        hl: 'en',
        gl: 'US',
      },
    };

    const data: Record<string, unknown> = {
      context,
      ...query,
    };

    const host = client.INNERTUBE_HOST || INNERTUBE_HOST;
    const url = `https://${host}/youtubei/v1/${endpoint}`;

    const ua = (client.INNERTUBE_CONTEXT.client.userAgent as string) ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': ua,
      'X-YouTube-Client-Name': String(client.INNERTUBE_CONTEXT_CLIENT_NAME),
      'X-YouTube-Client-Version': String(client.INNERTUBE_CONTEXT.client.clientVersion),
      'Origin': `https://${host}`,
      'Referer': `https://${host}/`,
    };

    this._log(`Fetching ${endpoint} via ${clientName} client`, videoId);

    const resp = await makeRequest(url, {
      method: 'POST',
      headers,
      data: JSON.stringify(data),
      query: { key: INNERTUBE_API_KEY, prettyPrint: 'false' },
    });

    if (resp.status >= 400) {
      throw new ExtractorError(`InnerTube API error (${clientName}): HTTP ${resp.status}`);
    }

    return resp.json();
  }

  // --- Extraction from webpage ---

  private _extractYtcfg(webpage: string, videoId: string): Record<string, unknown> {
    const match = webpage.match(/ytcfg\.set\s*\(\s*(\{[\s\S]*?\})\s*\)\s*;/);
    if (!match) return {};
    try {
      return JSON.parse(jsToJson(match[1])) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private _extractInitialData(webpage: string, videoId: string): Record<string, unknown> {
    const patterns = [
      /var\s+ytInitialData\s*=\s*(\{[\s\S]*?\})\s*;/,
      /window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\})\s*;/,
    ];
    for (const pattern of patterns) {
      const match = webpage.match(pattern);
      if (match) {
        try {
          return JSON.parse(match[1]) as Record<string, unknown>;
        } catch { continue; }
      }
    }
    return {};
  }

  private _extractInitialPlayerResponse(webpage: string, videoId: string): Record<string, unknown> | null {
    const patterns = [
      /var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\})\s*;/,
      /window\["ytInitialPlayerResponse"\]\s*=\s*(\{[\s\S]*?\})\s*;/,
    ];
    for (const pattern of patterns) {
      const match = webpage.match(pattern);
      if (match) {
        try {
          return JSON.parse(match[1]) as Record<string, unknown>;
        } catch { continue; }
      }
    }
    return null;
  }

  // --- Video details extraction ---

  private _extractVideoDetails(
    playerResponses: Record<string, unknown>[],
    initialData: Record<string, unknown>,
  ): {
    title: string;
    description: string;
    duration: number | undefined;
    uploader: string | null;
    uploaderId: string | null;
    uploaderUrl: string | null;
    channel: string | null;
    channelId: string | null;
    channelFollowerCount: number | null;
    viewCount: number | null;
    likeCount: number | null;
    ageLimit: number;
    categories: string[];
    tags: string[];
    availability: InfoDict['availability'];
  } {
    let title = '';
    let description = '';
    let duration: number | undefined;
    let uploader: string | null = null;
    let uploaderId: string | null = null;
    let uploaderUrl: string | null = null;
    let channel: string | null = null;
    let channelId: string | null = null;
    let channelFollowerCount: number | null = null;
    let viewCount: number | null = null;
    let likeCount: number | null = null;
    let ageLimit = 0;
    let categories: string[] = [];
    let tags: string[] = [];
    let availability: InfoDict['availability'] = 'public';

    for (const pr of playerResponses) {
      const vd = pr.videoDetails as Record<string, unknown> | undefined;
      if (!vd) continue;

      title = title || String(vd.title || '');
      description = description || String(vd.shortDescription || '');
      duration = duration || (intOrNone(vd.lengthSeconds) ?? undefined);
      channelId = channelId || strOrNone(vd.channelId);
      channel = channel || strOrNone(vd.author);
      viewCount = viewCount || intOrNone(vd.viewCount);

      if (Array.isArray(vd.keywords)) {
        tags = vd.keywords as string[];
      }

      if (vd.isLiveContent) {
        // Live content detected
      }
    }

    // Extract from microformat
    for (const pr of playerResponses) {
      const mf = traverseObj(pr, ['microformat', 'playerMicroformatRenderer']) as Record<string, unknown> | undefined;
      if (!mf) continue;

      title = title || String(mf.title && typeof mf.title === 'object' ? (mf.title as any).simpleText : mf.title || '');
      description = description || String(
        mf.description && typeof mf.description === 'object'
          ? (mf.description as any).simpleText
          : mf.description || ''
      );
      channelId = channelId || strOrNone(mf.externalChannelId);
      channel = channel || strOrNone(mf.ownerChannelName);
      uploaderId = uploaderId || strOrNone(mf.ownerProfileUrl)?.split('/').pop() || null;
      uploaderUrl = uploaderUrl || strOrNone(mf.ownerProfileUrl);

      if (mf.isFamilySafe === false) ageLimit = 18;
      if (Array.isArray(mf.category)) {
        categories = mf.category as string[];
      } else if (typeof mf.category === 'string') {
        categories = [mf.category];
      }

      if (mf.isUnlisted) availability = 'unlisted';
    }

    // Extract uploader/owner from initial data
    const owner = traverseObj(initialData, [
      'contents', 'twoColumnWatchNextResults', 'results', 'results',
      'contents',
    ]) as unknown[] | undefined;

    if (Array.isArray(owner)) {
      for (const item of owner) {
        const vso = traverseObj(item, ['videoSecondaryInfoRenderer', 'owner', 'videoOwnerRenderer']) as Record<string, unknown> | undefined;
        if (vso) {
          uploader = uploader || this._getText(vso.title);
          const navEndpoint = traverseObj(vso, ['navigationEndpoint', 'browseEndpoint']) as Record<string, unknown> | undefined;
          if (navEndpoint) {
            channelId = channelId || strOrNone(navEndpoint.browseId);
            const canonicalUrl = strOrNone(navEndpoint.canonicalBaseUrl);
            if (canonicalUrl) {
              uploaderUrl = `https://www.youtube.com${canonicalUrl}`;
              const handle = canonicalUrl.match(/@([\w.-]+)/)?.[1];
              if (handle) uploaderId = `@${handle}`;
            }
          }
          const subCount = this._getText(vso.subscriberCountText);
          if (subCount) {
            channelFollowerCount = this._parseCount(subCount);
          }
        }

        // Like count from primary info
        const vpi = (item as Record<string, unknown>).videoPrimaryInfoRenderer as Record<string, unknown> | undefined;
        if (vpi) {
          const likeBtn = traverseObj(vpi, [
            'videoActions', 'menuRenderer', 'topLevelButtons',
          ]) as unknown[] | undefined;
          if (Array.isArray(likeBtn)) {
            for (const btn of likeBtn) {
              const toggleBtn = traverseObj(btn, ['segmentedLikeDislikeButtonViewModel', 'likeButtonViewModel', 'likeButtonViewModel', 'toggleButtonViewModel', 'toggleButtonViewModel', 'defaultButtonViewModel', 'buttonViewModel']) as Record<string, unknown> | undefined;
              if (toggleBtn) {
                const accessText = strOrNone(toggleBtn.accessibilityText);
                if (accessText) {
                  likeCount = this._parseCount(accessText);
                }
              }
            }
          }
        }
      }
    }

    uploader = uploader || channel;

    return {
      title, description, duration, uploader, uploaderId, uploaderUrl,
      channel, channelId, channelFollowerCount, viewCount, likeCount,
      ageLimit, categories, tags, availability,
    };
  }

  private _extractMicroformat(playerResponses: Record<string, unknown>[]): {
    uploadDate: string | null;
    timestamp: number | null;
  } {
    for (const pr of playerResponses) {
      const mf = traverseObj(pr, ['microformat', 'playerMicroformatRenderer']) as Record<string, unknown> | undefined;
      if (!mf) continue;

      const publishDate = strOrNone(mf.publishDate) || strOrNone(mf.uploadDate);
      if (publishDate) {
        const timestamp = unifiedTimestamp(publishDate);
        const uploadDate = publishDate.replace(/-/g, '').slice(0, 8);
        return { uploadDate, timestamp };
      }
    }
    return { uploadDate: null, timestamp: null };
  }

  // --- Format extraction ---

  private _extractFormats(
    playerResponse: Record<string, unknown>,
    videoId: string,
    clientName: string = 'web',
  ): { formats: VideoFormat[]; subtitles: Record<string, Subtitle[]> } {
    const formats: VideoFormat[] = [];
    const subtitles: Record<string, Subtitle[]> = {};

    const streamingData = playerResponse.streamingData as Record<string, unknown> | undefined;
    if (!streamingData) return { formats, subtitles };

    // Extract adaptive formats
    const adaptiveFormats = (streamingData.adaptiveFormats || []) as Record<string, unknown>[];
    const regularFormats = (streamingData.formats || []) as Record<string, unknown>[];

    for (const fmt of [...regularFormats, ...adaptiveFormats]) {
      const url = strOrNone(fmt.url);
      const signatureCipher = strOrNone(fmt.signatureCipher) || strOrNone(fmt.cipher);

      let streamUrl: string | null = url;

      if (!streamUrl && signatureCipher) {
        // Parse signature cipher
        const params = new URLSearchParams(signatureCipher);
        streamUrl = params.get('url');
        // Note: Signature decryption requires JS player analysis
        // For now, we try the URL as-is (works for some clients)
        const sig = params.get('s');
        const sp = params.get('sp') || 'signature';
        if (streamUrl && sig) {
          // Without JS player, we can't decrypt. Skip encrypted formats.
          this._warn(`Skipping encrypted format (itag ${fmt.itag}) - signature decryption not available`, videoId);
          continue;
        }
      }

      if (!streamUrl) continue;

      const itag = intOrNone(fmt.itag);
      const itagInfo = itag ? ITAG_QUALITIES[itag] : undefined;
      const mimeType = strOrNone(fmt.mimeType) || '';
      const codecInfo = this._parseMimeType(mimeType);

      const width = intOrNone(fmt.width);
      const height = intOrNone(fmt.height);
      const fps = intOrNone(fmt.fps);
      const bitrate = intOrNone(fmt.bitrate);
      const averageBitrate = intOrNone(fmt.averageBitrate);
      const contentLength = intOrNone(fmt.contentLength);
      const approxDuration = floatOrNone(fmt.approxDurationMs, 1000);
      const quality = strOrNone(fmt.quality) || '';
      const qualityLabel = strOrNone(fmt.qualityLabel) || '';
      const audioQuality = strOrNone(fmt.audioQuality) || '';
      const audioSampleRate = intOrNone(fmt.audioSampleRate);
      const audioChannels = intOrNone(fmt.audioChannels);

      const isVideo = codecInfo.vcodec !== 'none';
      const isAudio = codecInfo.acodec !== 'none';
      const isDrc = strOrNone(fmt.isDrc) === 'true' || (fmt as any).isDrc === true;

      // Format ID
      let formatId = String(itag || formats.length);
      if (isDrc) formatId += '-drc';

      // Determine ext
      let ext = itagInfo?.ext || codecInfo.ext || 'mp4';
      if (!isVideo && isAudio) {
        ext = itagInfo?.ext || 'm4a';
        if (codecInfo.acodec?.startsWith('opus') || codecInfo.acodec?.startsWith('vorb')) {
          ext = 'webm';
        }
      }

      const format: VideoFormat = {
        format_id: formatId,
        url: streamUrl,
        ext,
        width: isVideo ? (width ?? itagInfo?.width) ?? undefined : undefined,
        height: isVideo ? (height ?? itagInfo?.height) ?? undefined : undefined,
        fps: isVideo ? (fps ?? itagInfo?.fps) ?? undefined : undefined,
        tbr: averageBitrate ? Math.round(averageBitrate / 1000) : (bitrate ? Math.round(bitrate / 1000) : undefined),
        abr: !isVideo && isAudio ? (averageBitrate ? Math.round(averageBitrate / 1000) : undefined) : undefined,
        vbr: isVideo && !isAudio ? (averageBitrate ? Math.round(averageBitrate / 1000) : undefined) : undefined,
        asr: audioSampleRate ?? undefined,
        audio_channels: audioChannels ?? undefined,
        vcodec: codecInfo.vcodec || (isVideo ? undefined : 'none'),
        acodec: codecInfo.acodec || (isAudio ? undefined : 'none'),
        filesize: contentLength ?? undefined,
        format_note: [
          qualityLabel || quality,
          isDrc ? 'DRC' : '',
          audioQuality.replace('AUDIO_QUALITY_', '').toLowerCase(),
        ].filter(Boolean).join(', ') || undefined,
        quality: this._qualityScore(quality),
        protocol: 'https',
        dynamic_range: isDrc ? 'SDR' : (strOrNone(fmt.colorInfo && (fmt.colorInfo as any).transferCharacteristics) === 'TRANSFER_CHARACTERISTICS_BT2020_10_BIT' ? 'HDR' : undefined),
        http_headers: this._getClientHeaders(clientName),
      };

      formats.push(format);
    }

    // HLS manifest
    const hlsUrl = strOrNone(streamingData.hlsManifestUrl);
    if (hlsUrl) {
      // We'll parse HLS separately if needed
      formats.push({
        format_id: 'hls-manifest',
        url: hlsUrl,
        ext: 'mp4',
        protocol: 'm3u8_native',
        format_note: 'HLS manifest',
        quality: -1,
      });
    }

    return { formats, subtitles };
  }

  private _getClientHeaders(clientName: string): Record<string, string> {
    const client = INNERTUBE_CLIENTS[clientName];
    const ua = (client?.INNERTUBE_CONTEXT?.client?.userAgent as string) ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    return {
      'User-Agent': ua,
      'Accept': '*/*',
      'Accept-Language': 'en-us,en;q=0.5',
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/',
    };
  }

  private _parseMimeType(mimeType: string): { vcodec: string; acodec: string; ext: string } {
    // e.g., video/mp4; codecs="avc1.640028" or audio/webm; codecs="opus"
    const match = mimeType.match(/^(video|audio)\/([\w]+)(?:;\s*codecs="([^"]+)")?/);
    if (!match) return { vcodec: 'none', acodec: 'none', ext: 'mp4' };

    const type = match[1]; // video or audio
    const container = match[2]; // mp4, webm, etc.
    const codecs = match[3] || '';

    const codecList = codecs.split(',').map(c => c.trim());
    let vcodec = 'none';
    let acodec = 'none';

    for (const codec of codecList) {
      if (/^(avc|hev|hvc|vp[089]|av01)/i.test(codec)) {
        vcodec = codec;
      } else if (/^(mp4a|opus|vorb|flac|ac-3|ec-3)/i.test(codec)) {
        acodec = codec;
      }
    }

    // If type is video and no video codec found, assume it's there
    if (type === 'video' && vcodec === 'none' && codecList.length > 0) {
      vcodec = codecList[0];
    }
    if (type === 'audio' && acodec === 'none' && codecList.length > 0) {
      acodec = codecList[0];
    }

    return { vcodec, acodec, ext: container };
  }

  private _qualityScore(quality: string): number {
    const map: Record<string, number> = {
      'tiny': -2, 'small': -1, 'medium': 0, 'large': 1,
      'hd720': 2, 'hd1080': 3, 'hd1440': 4, 'hd2160': 5,
      'highres': 6,
    };
    return map[quality] ?? 0;
  }

  // --- Caption/subtitle extraction ---

  private _extractCaptions(
    playerResponse: Record<string, unknown>,
    videoId: string,
  ): { subtitles: Record<string, Subtitle[]>; automaticCaptions: Record<string, Subtitle[]> } {
    const subtitles: Record<string, Subtitle[]> = {};
    const automaticCaptions: Record<string, Subtitle[]> = {};

    const captions = traverseObj(playerResponse, [
      'captions', 'playerCaptionsTracklistRenderer',
    ]) as Record<string, unknown> | undefined;

    if (!captions) return { subtitles, automaticCaptions };

    const captionTracks = (captions.captionTracks || []) as Record<string, unknown>[];

    for (const track of captionTracks) {
      const baseUrl = strOrNone(track.baseUrl);
      if (!baseUrl) continue;

      const lang = strOrNone(track.languageCode) || 'und';
      const name = this._getText(track.name) || lang;
      const kind = strOrNone(track.kind);
      const isAutoGenerated = kind === 'asr';

      const target = isAutoGenerated ? automaticCaptions : subtitles;

      // Add multiple subtitle formats
      for (const fmt of SUBTITLE_FORMATS) {
        const subUrl = new URL(baseUrl);
        subUrl.searchParams.set('fmt', fmt);
        // Remove exp parameter which triggers PO token requirement
        subUrl.searchParams.delete('exp');
        // Remove xosf which causes undesirable text positioning
        subUrl.searchParams.delete('xosf');
        // Update sparams to remove 'exp' reference
        const sparams = subUrl.searchParams.get('sparams');
        if (sparams) {
          subUrl.searchParams.set('sparams',
            sparams.split(',').filter(p => p !== 'exp').join(','));
        }

        if (!target[lang]) target[lang] = [];
        target[lang].push({
          url: subUrl.toString(),
          ext: fmt === 'json3' ? 'json' : fmt,
          name,
        });
      }

      // Extract translation languages
      const translationLanguages = (captions.translationLanguages || []) as Record<string, unknown>[];
      if (isAutoGenerated && translationLanguages.length > 0) {
        for (const tl of translationLanguages) {
          const tlCode = strOrNone(tl.languageCode);
          if (!tlCode || tlCode === lang) continue;

          for (const fmt of ['vtt', 'srt'] as const) {
            const transUrl = new URL(baseUrl);
            transUrl.searchParams.set('fmt', fmt === 'srt' ? 'srv3' : fmt);
            transUrl.searchParams.set('tlang', tlCode);
            transUrl.searchParams.delete('exp');
            transUrl.searchParams.delete('xosf');
            const sp = transUrl.searchParams.get('sparams');
            if (sp) transUrl.searchParams.set('sparams', sp.split(',').filter(p => p !== 'exp').join(','));

            if (!automaticCaptions[tlCode]) automaticCaptions[tlCode] = [];
            automaticCaptions[tlCode].push({
              url: transUrl.toString(),
              ext: fmt,
              name: this._getText(tl.languageName) || tlCode,
            });
          }
        }
      }
    }

    return { subtitles, automaticCaptions };
  }

  // --- Thumbnail extraction ---

  private _extractThumbnails(
    playerResponses: Record<string, unknown>[],
    videoId: string,
  ): Thumbnail[] {
    const thumbnails: Thumbnail[] = [];
    const seenUrls = new Set<string>();

    for (const pr of playerResponses) {
      const thumbs = traverseObj(pr, ['videoDetails', 'thumbnail', 'thumbnails']) as Record<string, unknown>[] | undefined;
      if (!Array.isArray(thumbs)) continue;

      for (const t of thumbs) {
        const url = urlOrNone(t.url);
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);

        thumbnails.push({
          url,
          width: intOrNone(t.width) ?? undefined,
          height: intOrNone(t.height) ?? undefined,
        });
      }
    }

    // Add standard YouTube thumbnail URLs
    const standardThumbs = [
      { id: 'default', url: `https://i.ytimg.com/vi/${videoId}/default.jpg`, width: 120, height: 90 },
      { id: 'mqdefault', url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, width: 320, height: 180 },
      { id: 'hqdefault', url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 480, height: 360 },
      { id: 'sddefault', url: `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`, width: 640, height: 480 },
      { id: 'maxresdefault', url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, width: 1280, height: 720 },
    ];

    for (const t of standardThumbs) {
      if (!seenUrls.has(t.url)) {
        thumbnails.push(t);
      }
    }

    return thumbnails;
  }

  // --- Chapter extraction ---

  private _extractChapters(
    initialData: Record<string, unknown>,
    description: string,
  ): Chapter[] {
    // Try from engagement panels (structured chapters)
    const chapters = this._extractChaptersFromEngagementPanel(initialData);
    if (chapters.length > 0) return chapters;

    // Fallback: parse from description
    return this._extractChaptersFromDescription(description);
  }

  private _extractChaptersFromEngagementPanel(initialData: Record<string, unknown>): Chapter[] {
    const chapters: Chapter[] = [];

    const panels = traverseObj(initialData, ['engagementPanels']) as unknown[] | undefined;
    if (!Array.isArray(panels)) return chapters;

    for (const panel of panels) {
      const macroMarkers = traverseObj(panel, [
        'engagementPanelSectionListRenderer', 'content',
        'macroMarkersListRenderer', 'contents',
      ]) as unknown[] | undefined;

      if (!Array.isArray(macroMarkers)) continue;

      for (const marker of macroMarkers) {
        const mr = (marker as Record<string, unknown>).macroMarkersListItemRenderer as Record<string, unknown> | undefined;
        if (!mr) continue;

        const title = this._getText(mr.title) || '';
        const timeDesc = strOrNone(
          traverseObj(mr, ['onTap', 'watchEndpoint', 'startTimeSeconds'])
        );
        const startTime = intOrNone(timeDesc);
        if (startTime === null) continue;

        chapters.push({
          start_time: startTime,
          end_time: 0, // Will be filled in
          title,
        });
      }
    }

    // Fill in end times
    for (let i = 0; i < chapters.length - 1; i++) {
      chapters[i].end_time = chapters[i + 1].start_time;
    }

    return chapters;
  }

  private _extractChaptersFromDescription(description: string): Chapter[] {
    const chapters: Chapter[] = [];
    // Match timestamps like 0:00, 1:23, 01:23:45
    const re = /(?:^|\n)\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)/g;
    const timeRe = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;
    let match;

    while ((match = re.exec(description)) !== null) {
      const fullLine = match[0].trim();
      const timeMatch = fullLine.match(timeRe);
      if (!timeMatch) continue;

      let seconds: number;
      if (timeMatch[3]) {
        seconds = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
      } else {
        seconds = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
      }

      const title = match[1].trim();
      chapters.push({
        start_time: seconds,
        end_time: 0,
        title,
      });
    }

    // Fill in end times
    for (let i = 0; i < chapters.length - 1; i++) {
      chapters[i].end_time = chapters[i + 1].start_time;
    }

    return chapters;
  }

  // --- Playability check ---

  private _checkPlayability(
    playerResponses: Record<string, unknown>[],
    videoId: string,
  ): { error: string | null } {
    for (const pr of playerResponses) {
      const ps = pr.playabilityStatus as Record<string, unknown> | undefined;
      if (!ps) continue;

      const status = strOrNone(ps.status);
      if (status === 'OK') return { error: null };

      if (status === 'LOGIN_REQUIRED') {
        return { error: 'This video requires login' };
      }
      if (status === 'UNPLAYABLE') {
        const reason = strOrNone(ps.reason) || 'Video is unplayable';
        return { error: reason };
      }
      if (status === 'ERROR') {
        const reason = strOrNone(ps.reason) || 'Video not available';
        return { error: reason };
      }
    }
    return { error: null };
  }

  // --- Live status ---

  private _extractLiveStatus(
    videoDetails: { duration: number | undefined },
    playerResponses: Record<string, unknown>[],
  ): InfoDict['live_status'] {
    for (const pr of playerResponses) {
      const vd = pr.videoDetails as Record<string, unknown> | undefined;
      if (!vd) continue;

      if (vd.isLive) return 'is_live';
      if (vd.isUpcoming) return 'is_upcoming';
      if (vd.isLiveContent) return 'was_live';
    }
    return 'not_live';
  }

  // --- Title extraction fallback ---

  private _extractTitle(
    webpage: string | null,
    initialData: Record<string, unknown>,
  ): string {
    if (webpage) {
      const title = this._htmlExtractTitle(webpage);
      if (title) {
        return title.replace(/ - YouTube$/, '');
      }
    }

    const title = traverseObj(initialData, [
      'contents', 'twoColumnWatchNextResults', 'results', 'results',
      'contents', 0, 'videoPrimaryInfoRenderer', 'title',
    ]);
    if (title) return this._getText(title);

    return 'Unknown';
  }

  // --- Helper methods ---

  private _getText(obj: unknown): string {
    if (!obj || typeof obj !== 'object') return String(obj || '');
    const o = obj as Record<string, unknown>;
    if (typeof o.simpleText === 'string') return o.simpleText;
    if (Array.isArray(o.runs)) {
      return (o.runs as Record<string, unknown>[])
        .map(r => String(r.text || ''))
        .join('');
    }
    return '';
  }

  private _parseCount(text: string): number | null {
    // Parse "1,234,567" or "1.2M" or "1.2K subscribers" etc.
    const cleaned = text.replace(/[,\s]/g, '').replace(/subscribers?|likes?/gi, '').trim();

    // Direct number
    const directMatch = cleaned.match(/^(\d+)$/);
    if (directMatch) return parseInt(directMatch[1]);

    // Abbreviated
    const abbrMatch = cleaned.match(/^([\d.]+)([KMB])/i);
    if (abbrMatch) {
      const num = parseFloat(abbrMatch[1]);
      const mult: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };
      return Math.round(num * (mult[abbrMatch[2].toUpperCase()] || 1));
    }

    return null;
  }

  private _mergeSubtitles(
    target: Record<string, Subtitle[]>,
    source: Record<string, Subtitle[]>,
  ): void {
    for (const [lang, subs] of Object.entries(source)) {
      if (!target[lang]) target[lang] = [];
      target[lang].push(...subs);
    }
  }
}

// --- YouTube Playlist extractor ---

export class YoutubePlaylistIE extends InfoExtractor {
  readonly IE_NAME = 'youtube:playlist';
  readonly _VALID_URL = /^(?:https?:\/\/)?(?:(?:www|m|music)\.)?youtube\.com\/(?:playlist\?list=|watch\?.*?&list=)([\w-]+)/;

  protected async _realExtract(url: string, match: RegExpMatchArray): Promise<InfoDict> {
    const playlistId = match[1];

    this._log('Fetching playlist', playlistId);

    const data = await this._callBrowseApi(playlistId);
    const metadata = traverseObj(data, ['metadata', 'playlistMetadataRenderer']) as Record<string, unknown> | undefined;
    const title = metadata ? strOrNone(metadata.title) : null;

    const entries = this._extractPlaylistEntries(data, playlistId);

    return {
      _type: 'playlist',
      id: playlistId,
      title: title || `Playlist ${playlistId}`,
      entries: entries as any,
      playlist_id: playlistId,
      playlist_title: title || undefined,
    };
  }

  private async _callBrowseApi(playlistId: string): Promise<Record<string, unknown>> {
    const context = {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20260114.08.00',
        hl: 'en',
        gl: 'US',
      },
    };

    const resp = await makeRequest(`https://www.youtube.com/youtubei/v1/browse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
      data: JSON.stringify({
        context,
        browseId: `VL${playlistId}`,
      }),
      query: { key: INNERTUBE_API_KEY, prettyPrint: 'false' },
    });

    return resp.json() as Record<string, unknown>;
  }

  private _extractPlaylistEntries(data: Record<string, unknown>, playlistId: string): InfoDict[] {
    const entries: InfoDict[] = [];

    const contents = traverseObj(data, [
      'contents', 'twoColumnBrowseResultsRenderer', 'tabs', 0,
      'tabRenderer', 'content', 'sectionListRenderer', 'contents', 0,
      'itemSectionRenderer', 'contents', 0,
      'playlistVideoListRenderer', 'contents',
    ]) as unknown[] | undefined;

    if (!Array.isArray(contents)) return entries;

    for (const item of contents) {
      const renderer = (item as Record<string, unknown>).playlistVideoRenderer as Record<string, unknown> | undefined;
      if (!renderer) continue;

      const videoId = strOrNone(renderer.videoId);
      if (!videoId) continue;

      entries.push({
        _type: 'url',
        id: videoId,
        title: this._getRendererText(renderer.title) || videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        duration: intOrNone(renderer.lengthSeconds) ?? undefined,
      });
    }

    return entries;
  }

  private _getRendererText(obj: unknown): string {
    if (!obj || typeof obj !== 'object') return '';
    const o = obj as Record<string, unknown>;
    if (typeof o.simpleText === 'string') return o.simpleText;
    if (Array.isArray(o.runs)) {
      return (o.runs as Record<string, unknown>[]).map(r => String(r.text || '')).join('');
    }
    return '';
  }
}

// --- YouTube Search extractor ---

export class YoutubeSearchIE extends InfoExtractor {
  readonly IE_NAME = 'youtube:search';
  readonly _VALID_URL = /^ytsearch(\d+)?:(.+)$/;

  protected async _realExtract(url: string, match: RegExpMatchArray): Promise<InfoDict> {
    const maxResults = parseInt(match[1] || '10', 10);
    const query = match[2];

    this._log(`Searching for "${query}"`, 'search');

    const context = {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20260114.08.00',
        hl: 'en',
        gl: 'US',
      },
    };

    const resp = await makeRequest('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
      data: JSON.stringify({ context, query }),
      query: { key: INNERTUBE_API_KEY, prettyPrint: 'false' },
    });

    const data = resp.json() as Record<string, unknown>;
    const entries: InfoDict[] = [];

    const contents = traverseObj(data, [
      'contents', 'twoColumnSearchResultsRenderer', 'primaryContents',
      'sectionListRenderer', 'contents',
    ]) as unknown[] | undefined;

    if (Array.isArray(contents)) {
      for (const section of contents) {
        const items = traverseObj(section, ['itemSectionRenderer', 'contents']) as unknown[] | undefined;
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          const vr = (item as Record<string, unknown>).videoRenderer as Record<string, unknown> | undefined;
          if (!vr) continue;

          const videoId = strOrNone(vr.videoId);
          if (!videoId) continue;
          if (entries.length >= maxResults) break;

          entries.push({
            _type: 'url',
            id: videoId,
            title: this._getRendererText(vr.title) || videoId,
            url: `https://www.youtube.com/watch?v=${videoId}`,
          });
        }
        if (entries.length >= maxResults) break;
      }
    }

    return {
      _type: 'playlist',
      id: `search:${query}`,
      title: `YouTube search: ${query}`,
      entries: entries as any,
    };
  }

  private _getRendererText(obj: unknown): string {
    if (!obj || typeof obj !== 'object') return '';
    const o = obj as Record<string, unknown>;
    if (typeof o.simpleText === 'string') return o.simpleText;
    if (Array.isArray(o.runs)) {
      return (o.runs as Record<string, unknown>[]).map(r => String(r.text || '')).join('');
    }
    return '';
  }
}

// Export all extractors
export const EXTRACTORS = [YoutubeIE, YoutubePlaylistIE, YoutubeSearchIE];
