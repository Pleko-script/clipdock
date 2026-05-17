# ClipDock Bins, Preview-First Layout, and Rotation Design

## Context

ClipDock is a local Electron, React, TypeScript, SQLite, FFmpeg, and FFprobe desktop app for browsing local video clips and dragging real media files into editors such as DaVinci Resolve. The current MVP supports linked folders, copied videos, thumbnails, search, tags, notes, favorites, preview, and native file drag. It does not yet have internal folders, context menus, a dominant preview workflow, or user-controlled clip rotation.

This design covers one focused feature package:

- Internal flat bins for organizing clips without moving source files.
- A preview-first layout with a much larger video area.
- Context menu and drag/drop organization actions.
- Non-destructive 90-degree rotation settings that produce a real rotated file only when needed for drag/drop.

In/out trimming and a full subclip editor are deliberately out of scope for this package.

## Goals

- Let users create flat ClipDock bins and organize clips inside them.
- Allow one clip to belong to multiple bins.
- Support drag/drop from clip cards into bins.
- Support right-click actions for clips and bins.
- Make the video preview the dominant part of the main view.
- Reduce metadata prominence to compact, useful facts.
- Let users rotate clips in 90-degree increments.
- Keep source media safe: never delete or move original files.
- When a rotated clip is dragged out, provide an actual rotated media file, not just a UI transform.

## Non-Goals

- No nested bins in this iteration.
- No source-file moves or source-file deletes.
- No in/out trimming, subclip rendering, timeline editing, or waveform editor.
- No Resolve scripting integration.
- No cloud sync, accounts, collaboration, telemetry, or remote logging.
- No broad design-system rewrite beyond the affected ClipDock workflow.

## UX Design

The main application layout changes from a three-column metadata-heavy browser to a two-area workflow:

- Left sidebar: navigation, filters, tags, bins, and import actions.
- Main workspace: search and controls, large preview stage, clip grid, and status bar.

The preview stage is the visual center. It shows the active clip in a larger 16:9 area, with compact adjacent controls for favorite, reveal/copy path, and rotation. Metadata is reduced to a small summary: duration, resolution, codec, FPS, size, and modified date. Tags and notes remain editable but no longer dominate the right side.

The sidebar contains:

- All Clips.
- Favorites.
- Tags.
- Bins.
- Add Bin.
- Add Folder.
- Copy Videos.

Bins are internal ClipDock folders. They do not correspond to file system directories. Dragging one or more selected clips onto a bin adds those clips to the bin. A clip can appear in multiple bins. When viewing a bin, a move action means "remove from the current bin and add to the target bin."

Right-click menus provide the expected direct actions:

- Clip menu: add to bin, move to bin when inside a bin, remove from current bin, remove from ClipDock, reveal in Explorer, copy path, favorite toggle.
- Bin menu: rename bin, delete bin.

"Remove from ClipDock" marks the clip removed in the local database and removes active bin assignments. Tag and note records may remain in historical rows if the store already keeps them with removed clips, but removed clips must not appear in active views or bin counts. It does not delete the source file.

## Rotation Behavior

Each clip has a saved rotation value: 0, 90, 180, or 270 degrees.

Changing rotation is immediate in the UI. The preview and thumbnail presentation apply a renderer-side transform so the user sees the selected orientation without waiting for FFmpeg.

Drag/drop behavior depends on rotation:

- Rotation 0: drag the original source file as ClipDock does today.
- Rotation 90, 180, or 270: before native drag starts, the main process resolves or renders a rotated export file and drags that file instead.

Rotated exports are non-destructive and stored in an app-owned cache/export directory. The original source media is never overwritten. A cached rotated export can be reused when the source path, source size, source modified timestamp, and rotation still match. If the source changes, ClipDock renders a new rotated variant.

If a rotated render fails, ClipDock does not silently drag the unrotated original. The drag fails and the status bar shows an error. For multi-clip drag, if any required rotated export fails, the whole drag fails.

## Data Model

SQLite gains the following persistence:

`bins`

- `id`
- `name`
- `sort_order`
- `created_at_ms`
- `updated_at_ms`

`clip_bins`

- `clip_id`
- `bin_id`
- `created_at_ms`
- Primary key on `clip_id, bin_id`.
- Foreign keys to `clips` and `bins`.
- Deleting a bin deletes its `clip_bins` assignments.
- Removing a clip from ClipDock deletes its `clip_bins` assignments.

`clips` additions

- `rotation_degrees`, constrained to 0, 90, 180, or 270, default 0.

Rotated export cache persistence is implemented as a dedicated table:

`clip_exports`

- `id`
- `clip_id`
- `variant_kind`, initially `rotation`
- `rotation_degrees`
- `source_size_bytes`
- `source_modified_at_ms`
- `export_path`
- `created_at_ms`
- `updated_at_ms`
- Unique key for clip, variant kind, rotation, size, and modified timestamp.

This keeps export cache state separate from canonical clip metadata and leaves room for later trim exports without changing the clip record shape again.

The library snapshot expands to include:

- `bins: LibraryBinRecordSummary[]`
- `clip.binIds: string[]`
- `clip.rotationDegrees: 0 | 90 | 180 | 270`

## API and Main Process

The renderer continues to use only the typed `window.clipdock` preload bridge. File system, SQLite, FFmpeg, shell, clipboard, and native drag remain owned by the Electron main process.

New API surface:

- `createBin(name)`
- `renameBin(binId, name)`
- `deleteBin(binId)`
- `addClipsToBin(clipIds, binId)`
- `moveClipsToBin(clipIds, fromBinId, toBinId)`
- `removeClipsFromBin(clipIds, binId)`
- `removeClipsFromLibrary(clipIds)`
- `updateClipRotation(clipId, rotationDegrees)`

Existing drag API remains renderer-initiated but main-process-resolved. Before `webContents.startDrag`, the main process validates each clip and asks a rotation export service for the correct drag path. The service returns the original file for 0 degrees or a cached/rendered export path for other rotations.

The FFmpeg rotation service should be isolated from IPC registration. Its job is to:

- Validate source file existence.
- Compute the cache key.
- Return a reusable export if valid.
- Render a missing or stale export.
- Persist export metadata.
- Return a `ClipdockResult<string>` path suitable for native drag.

## Frontend Structure

The current renderer is concentrated in `App.tsx`. This feature should split the affected UI into smaller units:

- `Sidebar`: filters, tags, bins, and import actions.
- `PreviewStage`: large video, compact metadata, rotation controls, and primary clip actions.
- `ClipGrid` and `ClipCard`: selection, drag start, and clip context menu entry point.
- `ContextMenu`: reusable menu component or hook for clip and bin context menus.
- Library hooks for snapshot actions, filtering, selection, and active clip state.

The main workspace should be structured as:

- Topbar with search, sort, favorite toggle, and rescan.
- Preview stage.
- Library meta row.
- Clip grid.
- Status bar.

On narrow screens, the sidebar stacks above the workspace, preview appears before the grid, and controls must not overlap or force unreadable text.

## Error Handling

- Missing clips remain represented in ClipDock with their existing metadata, bins, and rotation setting where possible.
- Bin operations validate non-empty names and valid IDs.
- Duplicate bin names are rejected case-insensitively with an inline/status error.
- Deleting a bin removes only bin assignments. Clips remain in All Clips.
- Removing a clip from ClipDock removes it from active views and bins but does not delete source media.
- Rotation render failure blocks drag and reports the FFmpeg/export error.
- Multi-clip drag fails as a whole if any clip path cannot be resolved.

## Testing Strategy

Update the MVP contract test to assert:

- New tables exist: `bins`, `clip_bins`, and export cache persistence.
- The shared contract exposes bins, bin IDs, rotation degrees, and new API methods.
- The preload bridge exposes only typed bin/rotation methods.
- The renderer includes the preview-first components and context menu surfaces.

Add or extend runtime tests for:

- Creating, renaming, and deleting bins.
- Adding a clip to multiple bins.
- Moving a clip between bins from a current bin context.
- Removing a clip from a bin without removing it from the library.
- Removing a clip from ClipDock without deleting the source file.
- Saving rotation values and rejecting invalid rotation values.
- Reusing a valid rotated export cache.
- Invalidating/re-rendering an export when source size or modified timestamp changes.

Run at minimum:

- `npm run test:mvp`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Implementation Boundaries

This package should be implemented without unrelated refactors. The only intentional structural refactor is splitting the renderer pieces directly affected by bins, preview, context menus, selection, and rotation controls.

The implementation should preserve existing security boundaries:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- No raw Electron or Node imports in the renderer.
- Renderer sends IDs and settings only; main process resolves file paths and performs native operations.

## Open Decisions Resolved

- Bins are internal ClipDock structures, not file system folders.
- Bins are flat for this iteration.
- Clips may belong to multiple bins.
- Delete/remove actions never delete source media.
- Rotation is visible immediately in the UI.
- Actual rotated media is rendered lazily when needed for drag/drop.
- In/out trimming is deferred to a future feature.
