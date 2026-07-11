# ClipDock

ClipDock is a local desktop library for transition clips, video overlays, and sound effects. Every item is a normal video or audio file that can be dragged into an editor such as DaVinci Resolve or Adobe Premiere Pro. ClipDock does not manage presets, templates, plugins, MOGRTs, installers, or image sequences.

The app is built with Electron, React, TypeScript, SQLite, FFmpeg, and FFprobe. It runs offline: no cloud, accounts, telemetry, or remote logging.

## Install and run

```bash
npm install
npm run dev
```

Build and verify with:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Create a Windows package with `npm run build:win`.

## Workflow

1. Select **Add Pack** and choose one folder. The folder becomes a pack; its subfolders become categories.
2. ClipDock scans supported video and audio files, stores metadata first, and generates previews in the background.
3. Browse the virtualized grid, search, filter by asset type, add favorites, tags, notes, or Collections, and correct automatic classifications in the Inspector.
4. Hover a card for playback or press `Space` for Quick Look. Quick Look can switch between the contextual preview and original media.
5. Drag one or multiple cards into the editor. ClipDock always passes the unchanged source files to the operating system.

Transitions are short standalone videos placed between two timeline clips. Overlays belong on a higher video track; use the alpha channel or Screen/Add blend mode as indicated. Sounds are dragged onto an audio track.

## Supported media

- Video: MP4, MOV, M4V, MKV, AVI, WebM, MPG, MPEG, TS, MTS, M2TS, and existing MXF compatibility.
- Audio: WAV, MP3, AAC, M4A, FLAC, and OGG.

Folder and filename terms classify transitions, overlays, and sounds automatically. FFprobe reads duration, resolution, FPS, codecs, audio properties, and detectable alpha channels. Classification and overlay mode remain editable.

## Keyboard

- `/`: focus search
- Arrow keys: navigate assets
- `Space`: Quick Look
- `F`: toggle favorite
- `Esc`: close Quick Look or stop playback
- `Ctrl/Cmd+A`, Shift-click, Ctrl/Cmd-click: multi-selection
- `+` / `-`: change thumbnail size

## Local data and safety

SQLite and generated preview files live under Electron's `userData/clipdock-library` folder. Source media is referenced in place and is never moved, modified, or deleted. A missing pack can be relinked while retaining asset IDs, favorites, tags, notes, and Collections.

The renderer uses a typed preload bridge with context isolation, sandboxing, disabled Node integration, and a constrained `clipdock-media://` protocol. Native drag paths, dialogs, SQLite, file access, FFmpeg, and FFprobe remain in the main process.

## Compatibility and limitations

Compatibility badges distinguish manually verified, expected, and unsupported combinations. Windows is the first supported test platform. H.264 MP4 transitions, ProRes 4444 alpha MOV overlays, H.264 screen overlays, WAV/MP3 sounds, multi-drag, and Unicode/long paths should be checked manually in Resolve and Premiere before a release is marked verified.

ClipDock does not place media on a timeline or control the editor. Black-background screen-overlay detection, similar-effect detection, duplicate detection, custom demo scenes, and portable metadata sidecars remain optional future work.

See [DESIGN.md](./DESIGN.md) for the UI system and interaction contract.
