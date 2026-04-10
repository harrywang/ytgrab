export interface VideoFormat {
  format_id: string;
  format_note?: string;
  ext: string;
  url: string;
  manifest_url?: string;
  protocol?: string;
  width?: number;
  height?: number;
  resolution?: string;
  fps?: number;
  tbr?: number;
  abr?: number;
  vbr?: number;
  asr?: number;
  acodec?: string;
  vcodec?: string;
  filesize?: number;
  filesize_approx?: number;
  quality?: number;
  source_preference?: number;
  language?: string;
  language_preference?: number;
  preference?: number;
  dynamic_range?: string;
  audio_channels?: number;
  container?: string;
  has_drm?: boolean;
  http_headers?: Record<string, string>;
  fragments?: Fragment[];
}

export interface Fragment {
  url: string;
  duration?: number;
  filesize?: number;
  path?: string;
}

export interface Thumbnail {
  id?: string;
  url: string;
  width?: number;
  height?: number;
  preference?: number;
  resolution?: string;
}

export interface Subtitle {
  url: string;
  ext: string;
  name?: string;
  data?: string;
}

export interface Chapter {
  start_time: number;
  end_time: number;
  title: string;
}

export interface InfoDict {
  id: string;
  title: string;
  description?: string;
  upload_date?: string;
  timestamp?: number;
  uploader?: string;
  uploader_id?: string;
  uploader_url?: string;
  channel?: string;
  channel_id?: string;
  channel_url?: string;
  channel_follower_count?: number;
  duration?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  age_limit?: number;
  webpage_url?: string;
  categories?: string[];
  tags?: string[];
  thumbnails?: Thumbnail[];
  subtitles?: Record<string, Subtitle[]>;
  automatic_captions?: Record<string, Subtitle[]>;
  formats?: VideoFormat[];
  requested_formats?: VideoFormat[];
  chapters?: Chapter[];
  live_status?: 'is_live' | 'was_live' | 'is_upcoming' | 'post_live' | 'not_live';
  release_timestamp?: number;
  availability?: 'public' | 'private' | 'unlisted' | 'premium_only' | 'needs_auth';
  ext?: string;
  url?: string;
  format?: string;
  format_id?: string;
  filepath?: string;
  _type?: 'video' | 'url' | 'playlist' | 'multi_video';
  entries?: InfoDict[] | AsyncIterable<InfoDict>;
  playlist_count?: number;
  playlist_title?: string;
  playlist_id?: string;
  [key: string]: unknown;
}

export interface DownloadProgress {
  status: 'downloading' | 'finished' | 'error';
  downloaded_bytes?: number;
  total_bytes?: number;
  total_bytes_estimate?: number;
  filename?: string;
  tmpfilename?: string;
  elapsed?: number;
  speed?: number;
  eta?: number;
  fragment_index?: number;
  fragment_count?: number;
}

export type ProgressHook = (progress: DownloadProgress) => void;
export type PostprocessorHook = (info: { status: string; postprocessor: string; info_dict: InfoDict }) => void;

export interface YtGrabOptions {
  format?: string;
  output?: string;
  quiet?: boolean;
  verbose?: boolean;
  noProgress?: boolean;
  writeSubtitles?: boolean;
  writeAutoSubtitles?: boolean;
  subtitleLanguages?: string[];
  subtitleFormat?: string;
  writeThumbnail?: boolean;
  writeInfoJson?: boolean;
  writeDescription?: boolean;
  skipDownload?: boolean;
  simulate?: boolean;
  listFormats?: boolean;
  listSubtitles?: boolean;
  extractAudio?: boolean;
  audioFormat?: string;
  audioQuality?: string;
  embedSubtitles?: boolean;
  embedThumbnail?: boolean;
  embedMetadata?: boolean;
  mergeOutputFormat?: string;
  cookies?: string;
  cookiesFromBrowser?: string;
  proxy?: string;
  rateLimit?: string;
  retries?: number;
  httpChunkSize?: number;
  maxDownloads?: number;
  paths?: Record<string, string>;
  progressHooks?: ProgressHook[];
  postprocessorHooks?: PostprocessorHook[];
  httpHeaders?: Record<string, string>;
  ffmpegLocation?: string;
  extractorArgs?: Record<string, string[]>;
  [key: string]: unknown;
}
