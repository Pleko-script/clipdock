# ClipDock

ClipDock is a local desktop video-library app for editor workflows, built as an Electron, React, TypeScript, SQLite, FFmpeg, and FFprobe app. It lets you add local video folders, scan clips recursively, browse thumbnails, search, tag, favorite, preview, and drag real video files out to tools such as DaVinci Resolve.

ClipDock runs fully locally. No cloud, no accounts, no collaboration, no telemetry, no remote logging, and no source-media deletion are part of the MVP.

## Install

```bash
npm install
```

The install includes bundled `ffmpeg-static` and `ffprobe-static` binaries used for local metadata extraction and thumbnail generation.

## Run Dev Mode

```bash
npm run dev
```

## Build

```bash
npm run build
```

Windows packaging is available with:

```bash
npm run build:win
```

## Verification

```bash
npm run test:mvp
npm run typecheck
npm run lint
npm run build
```

## Add A Video Folder

1. Start ClipDock with `npm run dev`.
2. Click `Add Folder`.
3. Pick a local folder that contains supported video files.
4. ClipDock recursively scans supported videos, extracts FFprobe metadata, generates cached thumbnails, and stores results in SQLite under Electron user data.
5. Use `Rescan` to re-check linked folders. Unchanged clips are cached by file path, size, and modified timestamp.

Supported extensions: `.mp4`, `.mov`, `.mxf`, `.mkv`, `.avi`, `.webm`, `.m4v`, `.mpg`, `.mpeg`, `.ts`, `.mts`, `.m2ts`.

## Daily Workflow

- Browse clips in the visual grid or focus the larger preview stage.
- Search by filename, path, tags, or notes.
- Filter favorites or tags from the sidebar.
- Create ClipDock bins in the sidebar for project, scene, client, or delivery groups.
- Drag clips onto bins, or use right-click menus to add, move, remove, rename, or delete.
- Click a clip to preview it. Metadata is available but kept secondary to playback.
- Double-click a clip to focus its preview.
- Rotate clips in 90 degree steps from the preview controls when phone or camera footage has the wrong orientation.
- Use the tag editor and notes panel to organize clips.
- Use `Reveal in Explorer`, `Copy Path`, or `Remove from ClipDock` from the right-click menu.

## Drag To DaVinci Resolve

Drag a clip card from ClipDock into a target that accepts normal OS file drops. The renderer sends clip IDs only through `window.clipdock`; the Electron main process resolves and validates the real local file path before calling native `webContents.startDrag`.

Primary target: DaVinci Resolve Media Pool. Direct timeline drops depend on Resolve's active panel and file-drop behavior. If Resolve rejects timeline drop, drop into the Media Pool first and then place the clip on the timeline.

Multi-select is available with Ctrl-click or Cmd-click. ClipDock attempts native multi-file drag when more than one selected clip is dragged; if a target app accepts only one file, drag a single clip.

Rotated clips stay non-destructive. When a rotated clip is dragged out, ClipDock renders or reuses an app-owned rotated MP4 variant and drags that file instead of modifying the source media.

## Local Data

- SQLite database: Electron `userData/clipdock-library/library.sqlite`
- Managed copied media: Electron `userData/clipdock-library/managed-media`
- Thumbnails: Electron `userData/clipdock-library/thumbnails`
- Rotated drag exports: Electron `userData/clipdock-library/exports`

Linked folders are referenced in place. Copied videos are explicit managed copies. Removing a clip or bin from ClipDock does not delete source media from disk.

## Security Boundary

- `contextIsolation` is enabled.
- `nodeIntegration` is disabled.
- The renderer sees only the typed `window.clipdock` preload API.
- File system, SQLite, FFmpeg, FFprobe, shell reveal, clipboard, and native drag operations stay in the Electron main process.
- Local preview and thumbnails are served through the constrained `clipdock-media://` protocol.

## Known Limitations

- Thumbnail generation creates one representative frame per clip, around 10 percent into the video with a 1 second fallback.
- Bad or unsupported files are skipped or stored with controlled scan errors; the scan continues.
- Grid virtualization is not yet added. The UI is structured for large libraries, but very large folders may need the planned virtualization pass.
- Drag-out compatibility is implemented as generic OS native file drag. Real DaVinci Resolve behavior must be smoke-tested on the target workstation.
- No in/out subclip rendering, proxy generation, waveform generation, AI tagging, Resolve scripting API, or advanced timeline editing is included in the MVP.
- Rotated drag exports currently target H.264 MP4 variants for compatibility.

## Future Roadmap

- Virtualized grid for very large libraries.
- In/out marks per clip and temporary subclip rendering.
- Resolve scripting `Send to DaVinci Resolve` action.
- Proxy and waveform generation.
- Similar-clip detection.
- Target-app drag compatibility matrix for Resolve, Premiere Pro, Final Cut Pro, Explorer/Finder, and media players.
