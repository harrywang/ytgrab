# ytgrab

A Node.js YouTube video downloader ported from [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## Features

- Download YouTube videos in available formats
- Download auto-generated and manual subtitles/captions
- Extract video metadata (title, description, thumbnails, chapters, etc.)
- N-parameter challenge solver (uses yt-dlp's EJS solver scripts)
- InnerTube API integration (android_vr, web_safari clients)
- Audio extraction with FFmpeg
- HLS/M3U8 stream downloading
- Playlist and search support
- CLI and programmatic API

## Requirements

- Node.js >= 18
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed (for the EJS challenge solver scripts)
- [FFmpeg](https://ffmpeg.org/) (optional, for audio extraction and format conversion)

## Installation

```bash
npm install
npm run build
```

## CLI Usage

```bash
# Download a video
node bin/ytgrab.js "https://www.youtube.com/watch?v=VIDEO_ID"

# Download with subtitles
node bin/ytgrab.js --write-auto-subs --sub-langs en "https://www.youtube.com/watch?v=VIDEO_ID"

# List available formats
node bin/ytgrab.js -F "https://www.youtube.com/watch?v=VIDEO_ID"

# Download to a specific directory
node bin/ytgrab.js -P /path/to/output "https://www.youtube.com/watch?v=VIDEO_ID"

# Extract audio as MP3
node bin/ytgrab.js -x --audio-format mp3 "https://www.youtube.com/watch?v=VIDEO_ID"

# Print video info as JSON
node bin/ytgrab.js -j "https://www.youtube.com/watch?v=VIDEO_ID"

# Download with custom format
node bin/ytgrab.js -f 720p "https://www.youtube.com/watch?v=VIDEO_ID"

# Write metadata files
node bin/ytgrab.js --write-info-json --write-thumbnail --write-description "URL"
```

Run `node bin/ytgrab.js -h` for all options.

## Programmatic API

```typescript
import { YtGrab } from 'ytgrab';

// Get video info without downloading
const yt = new YtGrab();
const info = await yt.getInfo('https://www.youtube.com/watch?v=VIDEO_ID');
console.log(info.title);
console.log(info.formats);
console.log(info.automatic_captions);

// Download a video
await yt.download('https://www.youtube.com/watch?v=VIDEO_ID');

// Download with options
const ytWithOpts = new YtGrab({
  format: 'best',
  output: '%(title)s.%(ext)s',
  writeSubtitles: true,
  subtitleLanguages: ['en'],
  paths: { home: './downloads' },
  progressHooks: [(progress) => {
    console.log(`${progress.status}: ${progress.downloaded_bytes} bytes`);
  }],
});
await ytWithOpts.download('https://www.youtube.com/watch?v=VIDEO_ID');

// Extract audio
const ytAudio = new YtGrab({
  extractAudio: true,
  audioFormat: 'mp3',
});
await ytAudio.download('https://www.youtube.com/watch?v=VIDEO_ID');

// List formats
const formats = await yt.listFormats('https://www.youtube.com/watch?v=VIDEO_ID');

// List subtitles
const subs = await yt.listSubtitles('https://www.youtube.com/watch?v=VIDEO_ID');
```

## Project Structure

```
ytgrab/
├── bin/ytgrab.js              # CLI entry point
├── src/
│   ├── index.ts               # Public API exports
│   ├── types.ts               # TypeScript interfaces
│   ├── ytgrab.ts              # Main orchestrator (YtGrab class)
│   ├── utils/
│   │   ├── index.ts           # Utility functions
│   │   └── traversal.ts       # traverse_obj / tryGet
│   ├── networking/
│   │   └── index.ts           # HTTP client
│   ├── extractor/
│   │   ├── common.ts          # Base InfoExtractor
│   │   ├── youtube.ts         # YouTube extractor
│   │   └── nsig.ts            # N-parameter challenge solver
│   ├── downloader/
│   │   ├── common.ts          # Base downloader
│   │   ├── http.ts            # HTTP downloader
│   │   ├── hls.ts             # HLS downloader
│   │   └── index.ts           # Downloader registry
│   └── postprocessor/
│       ├── common.ts          # Base post-processor
│       └── ffmpeg.ts          # FFmpeg post-processors
└── dist/                      # Compiled output
```

## How It Works

1. **Webpage fetch** — Downloads the YouTube watch page to extract the initial player response and player JS URL
2. **InnerTube API** — Calls YouTube's internal API with `android_vr` and `web_safari` clients to get video formats and captions
3. **N-parameter solving** — Uses yt-dlp's EJS challenge solver (meriyah + astring) to transform the `n` throttle parameter in format URLs
4. **Format selection** — Picks the best available format based on user preferences
5. **Download** — Downloads the video via HTTP with resume support, or HLS fragment downloading
6. **Post-processing** — Optional FFmpeg operations (audio extraction, format conversion, subtitle embedding)

## License

MIT
