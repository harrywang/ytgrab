# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

- **Build**: `npm run build` (runs `tsc`)
- **Dev mode**: `npm run dev` (runs `tsc --watch`)
- **Type check**: `npm run lint` (runs `tsc --noEmit`)
- **Test**: `npm test` (runs `node --test dist/**/*.test.js` — must build first)
- **Run CLI locally**: `node bin/ytgrab.js <url> [options]`

## Architecture

ytgrab is a Node.js YouTube downloader ported from yt-dlp. It mirrors yt-dlp's Python architecture in TypeScript.

### Core Data Flow

1. `YtGrab` (src/ytgrab.ts) receives a URL and options
2. Finds a matching **Extractor** (src/extractor/) based on URL pattern
3. Extractor calls YouTube's InnerTube API to get video metadata and format list
4. YtGrab selects the best format, solves n-parameter challenges to avoid throttling
5. A **Downloader** (HTTP or HLS) fetches the media
6. Optional **PostProcessors** transform the output (audio extraction, muxing via FFmpeg)

### Key Modules

- **src/ytgrab.ts**: Main orchestrator class (~420 lines). Handles format selection, n-param resolution, and coordinates the pipeline.
- **src/extractor/youtube.ts**: YoutubeIE, YoutubePlaylistIE, YoutubeSearchIE. Extracts video info from InnerTube API responses.
- **src/extractor/nsig.ts**: N-parameter challenge solver. Uses meriyah (JS parser) + astring (code generator) to parse and execute YouTube's throttle-avoidance functions.
- **src/downloader/http.ts / hls.ts**: HTTP downloader with resume support; HLS downloader for M3U8 streams.
- **src/postprocessor/ffmpeg.ts**: FFmpeg-based post-processors for audio extraction, subtitle/thumbnail embedding, metadata embedding, format conversion.
- **src/networking/**: HTTP client with automatic decompression.
- **src/utils/traversal.ts**: `traverseObj()` and `tryGet()` for safe nested object access on InnerTube API responses.

### Design Patterns

- **Template method**: Extractors implement `_realExtract()`, downloaders implement `realDownload()`, post-processors implement `run()`.
- **Progress hooks**: Callback-based progress reporting for downloads and post-processing.
- **Error hierarchy**: `ExtractorError`, `DownloadError`, `GeoRestrictedError`, `UnsupportedError`.

### Entry Points

- **CLI**: `bin/ytgrab.js` — uses Node's built-in `util.parseArgs()`
- **Programmatic API**: `src/index.ts` — exports `YtGrab` class and utilities

## Requirements

- Node.js 18+
- FFmpeg (optional, required for audio extraction and format conversion)
- TypeScript 5.4+

## Publishing

The GitHub Actions workflow (`.github/workflows/publish.yml`) triggers on **GitHub Release creation** (not tag push). To publish to npm: create a release via `gh release create v<version>`.
