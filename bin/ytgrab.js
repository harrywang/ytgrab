#!/usr/bin/env node

/**
 * ytgrab CLI - YouTube video downloader
 * Usage: ytgrab [OPTIONS] URL [URL...]
 */

import { parseArgs } from 'node:util';
import { YtGrab } from '../dist/index.js';

const { values: opts, positionals: urls } = parseArgs({
  allowPositionals: true,
  options: {
    // Output
    output: { type: 'string', short: 'o', default: '%(title)s [%(id)s].%(ext)s' },
    paths: { type: 'string', short: 'P' },

    // Format selection
    format: { type: 'string', short: 'f', default: 'best' },
    'merge-output-format': { type: 'string' },

    // Info
    'list-formats': { type: 'boolean', short: 'F', default: false },
    'list-subs': { type: 'boolean', default: false },
    'print-json': { type: 'boolean', short: 'j', default: false },
    simulate: { type: 'boolean', short: 's', default: false },
    'skip-download': { type: 'boolean', default: false },

    // Subtitles
    'write-subs': { type: 'boolean', default: false },
    'write-auto-subs': { type: 'boolean', default: false },
    'sub-langs': { type: 'string', default: 'en' },
    'sub-format': { type: 'string', default: 'srt' },

    // Thumbnails & metadata
    'write-thumbnail': { type: 'boolean', default: false },
    'write-info-json': { type: 'boolean', default: false },
    'write-description': { type: 'boolean', default: false },

    // Audio
    'extract-audio': { type: 'boolean', short: 'x', default: false },
    'audio-format': { type: 'string', default: 'mp3' },
    'audio-quality': { type: 'string', default: '5' },

    // Embedding
    'embed-subs': { type: 'boolean', default: false },
    'embed-thumbnail': { type: 'boolean', default: false },
    'embed-metadata': { type: 'boolean', default: false },

    // Network
    proxy: { type: 'string' },
    retries: { type: 'string', short: 'R', default: '10' },

    // FFmpeg
    'ffmpeg-location': { type: 'string' },

    // Verbosity
    quiet: { type: 'boolean', short: 'q', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    'no-progress': { type: 'boolean', default: false },

    // Help
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'V', default: false },
  },
});

if (opts.help) {
  console.log(`
ytgrab - YouTube video downloader for Node.js (ported from yt-dlp)

Usage: ytgrab [OPTIONS] URL [URL...]

Options:
  -o, --output TEMPLATE      Output filename template (default: %(title)s [%(id)s].%(ext)s)
  -P, --paths PATH           Output directory
  -f, --format FORMAT        Video format (default: best)
                             Examples: best, worst, bestaudio, 720p, 1080p, 137
  -F, --list-formats         List available formats and exit
      --list-subs            List available subtitles and exit
  -j, --print-json           Print info JSON and exit
  -s, --simulate             Do not download, just print info

  --write-subs               Download subtitles
  --write-auto-subs          Download auto-generated subtitles
  --sub-langs LANGS          Subtitle languages (comma-separated, default: en)
  --sub-format FMT           Subtitle format (default: srt)

  --write-thumbnail          Download thumbnail
  --write-info-json          Write video info to .info.json
  --write-description        Write description to .description

  -x, --extract-audio        Extract audio (requires FFmpeg)
  --audio-format FMT         Audio format: mp3, aac, opus, flac, wav (default: mp3)
  --audio-quality Q          Audio quality: 0 (best) to 9 (worst) (default: 5)

  --embed-subs               Embed subtitles (requires FFmpeg)
  --embed-thumbnail          Embed thumbnail (requires FFmpeg)
  --embed-metadata           Embed metadata (requires FFmpeg)
  --merge-output-format FMT  Merge format: mp4, mkv, webm

  --proxy URL                Use proxy
  -R, --retries N            Number of retries (default: 10)
  --ffmpeg-location PATH     FFmpeg binary path

  -q, --quiet                Suppress output
  -v, --verbose              Verbose output
  --no-progress              Hide progress bar

  -h, --help                 Show this help
  -V, --version              Show version
`);
  process.exit(0);
}

if (opts.version) {
  console.log('ytgrab 0.1.0');
  process.exit(0);
}

if (urls.length === 0) {
  console.error('Error: No URL provided. Use -h for help.');
  process.exit(1);
}

const ytgrab = new YtGrab({
  format: opts.format,
  output: opts.output,
  paths: opts.paths ? { home: opts.paths } : undefined,
  quiet: opts.quiet,
  verbose: opts.verbose,
  noProgress: opts['no-progress'],
  simulate: opts.simulate || opts['print-json'],
  skipDownload: opts['skip-download'],
  listFormats: opts['list-formats'],
  listSubtitles: opts['list-subs'],
  writeSubtitles: opts['write-subs'],
  writeAutoSubtitles: opts['write-auto-subs'],
  subtitleLanguages: opts['sub-langs']?.split(','),
  subtitleFormat: opts['sub-format'],
  writeThumbnail: opts['write-thumbnail'],
  writeInfoJson: opts['write-info-json'],
  writeDescription: opts['write-description'],
  extractAudio: opts['extract-audio'],
  audioFormat: opts['audio-format'],
  audioQuality: opts['audio-quality'],
  embedSubtitles: opts['embed-subs'],
  embedThumbnail: opts['embed-thumbnail'],
  embedMetadata: opts['embed-metadata'],
  mergeOutputFormat: opts['merge-output-format'],
  proxy: opts.proxy,
  retries: parseInt(opts.retries || '10'),
  ffmpegLocation: opts['ffmpeg-location'],
  progressHooks: opts.quiet ? [] : [
    (progress) => {
      if (opts['no-progress']) return;
      if (progress.status === 'downloading') {
        const pct = progress.total_bytes
          ? ((progress.downloaded_bytes || 0) / progress.total_bytes * 100).toFixed(1)
          : '?';
        const speed = progress.speed
          ? `${(progress.speed / 1024 / 1024).toFixed(2)} MiB/s`
          : '? MiB/s';
        const eta = progress.eta ? `ETA ${progress.eta}s` : '';
        const frag = progress.fragment_count
          ? `frag ${progress.fragment_index}/${progress.fragment_count}`
          : '';
        process.stdout.write(
          `\r[download] ${pct}% ${speed} ${eta} ${frag}`.padEnd(80)
        );
      } else if (progress.status === 'finished') {
        process.stdout.write('\n');
      }
    },
  ],
});

async function main() {
  try {
    if (opts['print-json']) {
      for (const url of urls) {
        const info = await ytgrab.getInfo(url);
        console.log(JSON.stringify(info, null, 2));
      }
    } else {
      await ytgrab.download(urls);
    }
  } catch (err) {
    console.error(`ERROR: ${(err).message}`);
    process.exit(1);
  }
}

main();
