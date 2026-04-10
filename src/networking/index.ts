/**
 * Networking layer ported from yt_dlp/networking/
 * Uses Node.js built-in fetch (Node 18+) and http/https modules.
 */

import * as https from 'node:https';
import * as http from 'node:http';
import * as zlib from 'node:zlib';
import { URL, URLSearchParams } from 'node:url';

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  data?: string | Buffer;
  query?: Record<string, string>;
  timeout?: number;
  proxy?: string;
  maxRedirects?: number;
}

export interface Response {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  text(): string;
  json(): unknown;
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-us,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate',
};

function decompressBody(body: Buffer, encoding: string | undefined): Buffer {
  if (!encoding) return body;
  if (encoding === 'gzip') return zlib.gunzipSync(body);
  if (encoding === 'deflate') return zlib.inflateSync(body);
  if (encoding === 'br') return zlib.brotliDecompressSync(body);
  return body;
}

export function makeRequest(url: string, options: RequestOptions = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    if (options.query) {
      for (const [key, val] of Object.entries(options.query)) {
        parsedUrl.searchParams.set(key, val);
      }
    }

    const headers = { ...DEFAULT_HEADERS, ...options.headers };
    const method = options.method || (options.data ? 'POST' : 'GET');

    if (options.data && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const requestOptions: https.RequestOptions = {
      method,
      headers,
      timeout: options.timeout || 30000,
    };

    let redirectCount = 0;
    const maxRedirects = options.maxRedirects ?? 5;

    function doRequest(requestUrl: URL): void {
      const transport = requestUrl.protocol === 'https:' ? https : http;
      const req = transport.request(requestUrl, requestOptions, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirectCount++;
          if (redirectCount > maxRedirects) {
            reject(new Error(`Too many redirects (${maxRedirects})`));
            return;
          }
          const redirectUrl = new URL(res.headers.location, requestUrl);
          doRequest(redirectUrl);
          return;
        }

        const chunks: Uint8Array[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          let body: Buffer = Buffer.concat(chunks);
          try {
            body = decompressBody(body, res.headers['content-encoding']);
          } catch {
            // Use raw body if decompression fails
          }

          const responseHeaders: Record<string, string> = {};
          for (const [key, val] of Object.entries(res.headers)) {
            if (val) responseHeaders[key] = Array.isArray(val) ? val.join(', ') : val;
          }

          resolve({
            url: requestUrl.toString(),
            status: res.statusCode || 0,
            headers: responseHeaders,
            body,
            text() { return body.toString('utf-8'); },
            json() { return JSON.parse(body.toString('utf-8')); },
          });
        });
        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out: ${requestUrl.toString()}`));
      });

      if (options.data) {
        req.write(typeof options.data === 'string' ? options.data : options.data);
      }
      req.end();
    }

    doRequest(parsedUrl);
  });
}

export class HTTPHeaderDict {
  private _store: Map<string, [string, string]> = new Map();

  constructor(init?: Record<string, string>) {
    if (init) {
      for (const [key, val] of Object.entries(init)) {
        this.set(key, val);
      }
    }
  }

  set(key: string, value: string): void {
    this._store.set(key.toLowerCase(), [key, value]);
  }

  get(key: string): string | undefined {
    return this._store.get(key.toLowerCase())?.[1];
  }

  has(key: string): boolean {
    return this._store.has(key.toLowerCase());
  }

  delete(key: string): void {
    this._store.delete(key.toLowerCase());
  }

  toObject(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [original, value] of this._store.values()) {
      result[original] = value;
    }
    return result;
  }
}

export function randomUserAgent(): string {
  const major = 120 + Math.floor(Math.random() * 15);
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
