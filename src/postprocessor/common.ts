/**
 * Base PostProcessor - ported from yt_dlp/postprocessor/common.py
 */

import type { InfoDict, PostprocessorHook } from '../types.js';

export abstract class PostProcessor {
  protected _downloader: any = null;
  protected _progressHooks: PostprocessorHook[] = [];
  readonly PP_NAME: string;

  constructor(downloader?: any) {
    this.PP_NAME = this.ppKey();
    if (downloader) this.setDownloader(downloader);
  }

  abstract ppKey(): string;

  setDownloader(downloader: any): void {
    this._downloader = downloader;
  }

  /**
   * Run post-processing on the info dict.
   * @returns [files_to_delete, modified_info_dict]
   */
  abstract run(information: InfoDict): Promise<[string[], InfoDict]>;

  protected _log(msg: string): void {
    if (this._downloader?.params?.quiet) return;
    if (this._downloader) {
      this._downloader.toScreen(`[${this.PP_NAME}] ${msg}`);
    } else {
      console.log(`[${this.PP_NAME}] ${msg}`);
    }
  }

  protected _warn(msg: string): void {
    if (this._downloader) {
      this._downloader.reportWarning(`[${this.PP_NAME}] ${msg}`);
    } else {
      console.warn(`WARNING: [${this.PP_NAME}] ${msg}`);
    }
  }

  protected getParam(name: string, defaultVal?: unknown): unknown {
    return this._downloader?.params?.[name] ?? defaultVal;
  }
}
