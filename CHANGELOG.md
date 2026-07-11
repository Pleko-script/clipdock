# Changelog

All notable changes to ClipDock are documented in this file.

## [1.1.0] - 2026-07-11

### Added

- Non-destructive In/Out ranges with an accessible dual-thumb timeline.
- Left and right video rotation in 90-degree steps.
- Cached H.264 and ProRes 4444 derivatives for trimmed or rotated drag-and-drop media.
- Complete German and English interface with a persistent language switcher.
- Persistent preview-volume slider and mute control for videos with audio.

### Changed

- Moved the media editor from the right sidebar to a centered, collapsible workspace above the asset grid.
- Switched the editor preview to a square `contain` stage so full portrait and landscape frames remain visible at every supported rotation.
- Shows organization controls to the left and file details to the right of the centered editor.
- Removed the editor's internal scrollbar while keeping the asset grid available below.
- Refined the interface into a quieter neutral editing workspace with bundled Commissioner and Fragment Mono fonts.

### Fixed

- Restored the video rotation workflow.
- Normalized missing legacy rotation values to `0°` instead of displaying `NaN°`.
- Prevented 9:16 footage from being cropped in the editor.
- Kept asset-grid space available at smaller window heights while the editor is open.
- Prevented range-slider keyboard input from leaking into global asset navigation.

## [1.0.0] - 2026-07-11

- Initial public Windows release of the local transition, overlay, and sound library.

[1.1.0]: https://github.com/Pleko-script/clipdock/releases/tag/v1.1.0
[1.0.0]: https://github.com/Pleko-script/clipdock/releases/tag/v1.0.0
