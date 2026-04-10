/**
 * YouTube n-parameter (throttle) challenge solver.
 *
 * Uses the yt-dlp EJS challenge solver scripts (yt.solver.core.js) with
 * meriyah (JS parser) and astring (AST code generator) to extract and
 * solve n-parameter transformations from YouTube player JavaScript.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeRequest } from '../networking/index.js';

// Cache
const nResultCache = new Map<string, Map<string, string>>();
const playerJsCache = new Map<string, string>();
let solverFn: ((input: unknown) => unknown) | null = null;

/**
 * Extract the player URL from a YouTube webpage.
 */
export function extractPlayerUrl(webpage: string): string | null {
  const patterns = [
    /"jsUrl"\s*:\s*"([^"]+base\.js)"/,
    /"PLAYER_JS_URL"\s*:\s*"([^"]+base\.js)"/,
    /\/s\/player\/([a-zA-Z0-9_-]+)\/player_ias\.vflset\/[a-z]{2}_[A-Z]{2}\/base\.js/,
    /\/s\/player\/([a-zA-Z0-9_-]+)\/player_es6\.vflset\/[a-z]{2}_[A-Z]{2}\/base\.js/,
  ];

  for (const pattern of patterns) {
    const match = webpage.match(pattern);
    if (match) {
      const url = match[1] || match[0];
      if (url.startsWith('http')) return url;
      return `https://www.youtube.com${url}`;
    }
  }
  return null;
}

/**
 * Download the player JavaScript source.
 */
async function downloadPlayerJs(playerUrl: string): Promise<string> {
  if (playerJsCache.has(playerUrl)) {
    return playerJsCache.get(playerUrl)!;
  }

  const resp = await makeRequest(playerUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    },
  });

  const js = resp.text();
  playerJsCache.set(playerUrl, js);
  return js;
}

/**
 * Initialize the EJS solver by loading the core script.
 */
async function initSolver(): Promise<((input: unknown) => unknown) | null> {
  if (solverFn) return solverFn;

  // Find the core solver script
  const searchPaths = [
    path.resolve(__dirname, '../../../../yt-dlp/yt_dlp/extractor/youtube/jsc/_builtin/vendor'),
    path.resolve(process.cwd(), '../yt-dlp/yt_dlp/extractor/youtube/jsc/_builtin/vendor'),
    path.resolve(process.cwd(), 'vendor'),
  ];

  let coreScript: string | null = null;
  for (const dir of searchPaths) {
    const corePath = path.join(dir, 'yt.solver.core.js');
    if (fs.existsSync(corePath)) {
      coreScript = fs.readFileSync(corePath, 'utf-8');
      break;
    }
  }

  if (!coreScript) return null;

  try {
    // Load meriyah and astring
    const meriyah = await import('meriyah');
    const astring = await import('astring');

    // The core script is an IIFE:
    //   var jsc = (function(meriyah, astring) { ... })(meriyah, astring);
    // The IIFE passes meriyah/astring from outer scope as args.
    // We need them available as variables when the script evaluates.
    const wrappedScript = `
      var meriyah = arguments[0];
      var astring = arguments[1];
      ${coreScript}
      return jsc;
    `;

    const fn = new Function(wrappedScript);
    solverFn = fn(meriyah, astring) as (input: unknown) => unknown;
    return solverFn;
  } catch (err) {
    // Solver initialization failed
    return null;
  }
}

/**
 * Solve n-parameter challenges using the EJS solver.
 */
async function solveNWithEJS(
  playerUrl: string,
  challenges: string[],
): Promise<Map<string, string>> {
  const solver = await initSolver();
  if (!solver) return new Map();

  const playerJs = await downloadPlayerJs(playerUrl);

  try {
    const output = solver({
      type: 'player',
      player: playerJs,
      requests: [{ type: 'n', challenges }],
      output_preprocessed: false,
    }) as { type: string; error?: string; responses?: Array<{ type: string; data?: Record<string, string>; error?: string }> };

    if (output.type === 'error') {
      return new Map();
    }

    const results = new Map<string, string>();
    if (output.responses?.[0]?.data) {
      for (const [key, val] of Object.entries(output.responses[0].data)) {
        results.set(key, val);
      }
    }
    return results;
  } catch {
    return new Map();
  }
}

/**
 * Solve the n-parameter challenge for a given video URL.
 */
export async function solveNChallenge(formatUrl: string, playerUrl: string): Promise<string> {
  const url = new URL(formatUrl);
  const nParam = url.searchParams.get('n');
  if (!nParam) return formatUrl;

  // Check cache
  const cached = nResultCache.get(playerUrl);
  if (cached?.has(nParam)) {
    url.searchParams.set('n', cached.get(nParam)!);
    return url.toString();
  }

  // Solve with EJS
  const results = await solveNWithEJS(playerUrl, [nParam]);
  if (results.size > 0) {
    if (!nResultCache.has(playerUrl)) nResultCache.set(playerUrl, new Map());
    for (const [k, v] of results) {
      nResultCache.get(playerUrl)!.set(k, v);
    }
    const solved = results.get(nParam);
    if (solved) {
      url.searchParams.set('n', solved);
      return url.toString();
    }
  }

  return formatUrl;
}

export function clearNSigCache(): void {
  nResultCache.clear();
  playerJsCache.clear();
  solverFn = null;
}
