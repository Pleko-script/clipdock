<div align="center">

# ClipDock

### Find the right effect. Preview it in context. Drag it into your edit.

A fast, local desktop library for **transition clips**, **video overlays**, and **sound effects**.

[![Platform](https://img.shields.io/badge/platform-Windows-55C2FF?style=flat-square&logo=windows11&logoColor=white)](#platform-support)
[![Local first](https://img.shields.io/badge/data-local%20only-15191F?style=flat-square)](#local-by-design)
[![Electron](https://img.shields.io/badge/Electron-39-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[Features](#features) · [Quick start](#quick-start) · [Workflow](#workflow) · [Architecture](#architecture)

</div>

---

ClipDock keeps reusable editing assets out of scattered folders and inside one visual, searchable library. Hover to preview an effect, press `Space` for a larger contextual preview, then drag the unchanged source file directly into your editor.

> [!IMPORTANT]
> ClipDock manages normal video and audio files—not plugins, presets, templates, MOGRTs, installers, or image sequences. It never modifies your source media and does not control your editor's timeline.

## Why ClipDock?

Effect libraries grow quickly. Finding one transition or sound often means opening folders, guessing from filenames, and previewing files one by one. ClipDock turns that folder archive into a focused editing tool:

- **See the effect before using it.** Transitions and overlays are rendered against local demo scenes; sounds get cached waveforms.
- **Stay inside your existing workflow.** Drag one or multiple real media files into DaVinci Resolve, Adobe Premiere Pro, or another editor.
- **Organize without touching disk.** Packs, Collections, tags, notes, and favorites live in ClipDock while source files stay where they are.
- **Work without an account.** Everything—including metadata, search, and generated previews—runs locally.

## Features

|              | Feature                   | What it does                                                                                                       |
| ------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Browse**   | Virtualized asset grid    | Keeps large libraries responsive while showing full-bleed thumbnails.                                              |
| **Preview**  | Contextual playback       | Shows transitions between demo clips, overlays over a neutral scene, and sounds as waveforms.                      |
| **Find**     | Search and filters        | Searches filenames, packs, folders, tags, and notes; filters by asset type, format, pack, Collection, or favorite. |
| **Organize** | Packs and Collections     | Treats each imported folder as a pack and its subfolders as categories. Collections never move files.              |
| **Classify** | Automatic asset detection | Recognizes common transition, overlay, and sound naming patterns; every result remains editable.                   |
| **Inspect**  | Media metadata            | Reads duration, resolution, FPS, codecs, audio properties, and detectable alpha channels with FFprobe.             |
| **Deliver**  | Native multi-file drag    | Resolves and validates real local paths in Electron's main process before starting the OS drag.                    |
| **Recover**  | Missing-media relink      | Points a moved pack at a new root while preserving favorites, tags, notes, and Collections.                        |

## Workflow

### 1. Add a pack

Choose **Add Pack** and select a folder containing effects. The selected folder becomes one pack; its subfolders become browsable categories.

### 2. Find and preview

ClipDock scans supported media, stores metadata first, and generates previews in the background. Search, filter, favorite, or group assets into Collections. Hover a card for a quick preview or press `Space` for Quick Look.

### 3. Drag into the edit

Drag a card—or a multi-selection—into your editor:

| Asset          | Typical timeline placement         | Context preview                           |
| -------------- | ---------------------------------- | ----------------------------------------- |
| **Transition** | Between two normal video clips     | Demo A → transition clip → Demo B         |
| **Overlay**    | On a video track above the footage | Composited over a generated neutral scene |
| **Sound**      | On an audio track                  | Waveform with original audio playback     |

For a black-background overlay, use a **Screen/Add** blend mode in the editor. Alpha-capable media is marked automatically when FFprobe can detect it.

## Quick start

### Requirements

- Windows 10 or 11 for the currently tested platform
- [Node.js 22](https://nodejs.org/) and npm
- Git

### Run in development

```bash
git clone https://github.com/Pleko-script/clipdock.git
cd clipdock
npm install
npm run dev
```

### Build the Windows app

```bash
npm run build:win
```

To verify a local checkout before contributing:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Supported media

| Type  | Extensions                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------ |
| Video | `.mp4`, `.mov`, `.mxf`, `.m4v`, `.mkv`, `.avi`, `.webm`, `.mpg`, `.mpeg`, `.ts`, `.mts`, `.m2ts` |
| Audio | `.wav`, `.mp3`, `.aac`, `.m4a`, `.flac`, `.ogg`                                                  |

Format support does not guarantee that every codec inside a container is accepted by every editing application. ClipDock distinguishes **Verified**, **Expected**, and **Unsupported** compatibility instead of claiming universal support.

## Keyboard workflow

| Shortcut                      | Action                            |
| ----------------------------- | --------------------------------- |
| `/`                           | Focus search                      |
| Arrow keys                    | Move through assets               |
| `Space`                       | Open Quick Look                   |
| `F`                           | Toggle favorite                   |
| `Esc`                         | Close Quick Look or stop playback |
| `Ctrl/Cmd+A`                  | Select the loaded result page     |
| `Shift` or `Ctrl/Cmd` + click | Range or additive selection       |
| `+` / `-`                     | Change thumbnail size             |

## Local by design

ClipDock is deliberately offline and account-free:

- Source files are referenced in place and are **never moved, modified, or deleted**.
- SQLite data and generated previews stay under Electron's local `userData/clipdock-library` directory.
- There is no cloud synchronization, telemetry, remote logging, or AI generation.
- The renderer has no direct file-system access. SQLite, FFmpeg, FFprobe, dialogs, shell actions, and native drag operations stay behind a typed preload bridge in the main process.
- Context isolation, renderer sandboxing, disabled Node integration, and a constrained `clipdock-media://` protocol reduce the renderer's privileges.

## Architecture

```text
React renderer
  └─ typed preload API
      └─ Electron main process
          ├─ SQLite asset store and search
          ├─ pack scanner and metadata analysis
          ├─ persistent FFmpeg preview queue (max. 2 jobs)
          └─ validated native file drag
```

The interface uses React and TanStack Virtual. Electron owns all privileged operations. SQLite stores packs, assets, Collections, tags, and persistent preview jobs. FFprobe analyzes media; FFmpeg creates silent H.264 context previews, WebP thumbnails, and sound waveforms.

The visual and interaction system is documented in [DESIGN.md](./DESIGN.md).

## Platform support

| Platform / target  | Status                                                                     |
| ------------------ | -------------------------------------------------------------------------- |
| Windows 10/11      | Primary development platform                                               |
| DaVinci Resolve    | Native file drag implemented; practical format matrix still being expanded |
| Adobe Premiere Pro | Native file drag implemented; practical format matrix still being expanded |
| macOS / Linux      | Build scripts exist, but these platforms are not currently validated       |

Long paths, spaces, and Unicode filenames are preserved by the native drag path. If an editor rejects a codec, transcode the source to a format supported by that editor; ClipDock intentionally does not modify it for you.

## Project status

ClipDock is an early-stage local-first project. The current focus is a reliable Windows workflow for reusable transitions, overlays, and sounds.

Potential next steps:

- Custom preview backgrounds
- Better detection of black-background Screen/Add overlays
- Exact duplicate and similar-effect detection
- Portable pack metadata sidecars
- A larger manually verified Resolve/Premiere compatibility matrix

Marketplace features, accounts, cloud sync, presets, templates, and editor plugins are intentionally out of scope.

## Contributing

Bug reports and focused pull requests are welcome. Before opening a PR:

1. Keep the product limited to real video and audio assets.
2. Do not move, rewrite, or delete user source media.
3. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
4. Describe editor, operating-system, format, codec, and path details for drag-related bugs.

Use [GitHub Issues](https://github.com/Pleko-script/clipdock/issues) for bugs and feature discussions.

---

<div align="center">

**Local effects. Fast previews. Real files.**

</div>
