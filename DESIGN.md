# ClipDock design system

## Product principle

ClipDock is a fast staging surface between an effect library and a video editor. The grid is the product: controls stay compact, metadata stays secondary, and every asset remains recognizably draggable media.

## Visual tokens

| Token          | Value     | Use                                 |
| -------------- | --------- | ----------------------------------- |
| Background     | `#0B0D10` | Application canvas and media wells  |
| Surface        | `#15191F` | Cards and fields                    |
| Raised surface | `#1B2027` | Hover and selected controls         |
| Line           | `#2A313B` | Dividers and quiet borders          |
| Text           | `#F2F5F7` | Primary labels                      |
| Secondary text | `#8F9AA8` | Metadata and inactive navigation    |
| Selection      | `#55C2FF` | Focus, selection, native drag state |
| Favorite       | `#F6C85F` | Favorite state only                 |
| Error          | `#FF6B7A` | Missing media and failures          |

Typography uses bundled IBM Plex Sans at 400/500/600 and IBM Plex Mono for timecodes, counts, and technical media information. The base spacing unit is 4 px; common gaps are 8, 12, 16, and 24 px. Controls use 5–8 px radii; the interface avoids decorative gradients except subtle media placeholders and contrast masks.

## Layout

- Sidebar: 228 px, packs and organization.
- Toolbar: 58 px, search, type tabs, sort, density, Inspector, and rescan.
- Results bar: 31 px, current scope and selection count.
- Grid: remaining space, row-virtualized, 14 px gaps, responsive columns.
- Inspector: optional 318 px panel for classification and technical details.
- Status bar: 25 px for scan and preview progress.
- Quick Look: centered modal up to 1040 × 710 px with Context/Original switching.

At widths below 1180 px the Inspector collapses so the grid remains useful. The minimum application width is 900 px.

## Asset cards and states

Cards use a 16:9 full-bleed visual, then two compact text lines. Asset kind appears at top left; favorite at top right; alpha, format, and duration badges sit at the lower edge. Technical badges use IBM Plex Mono.

- Default: transparent border, quiet shadow.
- Hover: raised by 1 px and bordered; preview starts after 250 ms for video or 300 ms for sound.
- Selected: blue border and halo.
- Keyboard-active: secondary outer focus ring.
- Favorite: yellow heart, always visible.
- Missing/error: reduced card opacity and explicit red overlay; the item remains selectable for recovery.
- Preview pending: small status label without blocking the card.

Only three video hover previews may run at once. Only one sound may play at once. Leaving a card stops its hover preview.

## Preview rules

- Transition: local Demo A, transition source, local Demo B.
- Alpha overlay: source composited over a generated neutral test scene.
- Screen overlay: source blended over the same scene with Screen mode.
- Raw video: original video scaled into the preview frame.
- Sound: cached waveform and original audio playback.

Generated video previews are silent, no longer than four seconds, H.264 MP4, and at most 480p. The thumbnail comes from the generated context preview. Quick Look exposes Context and Original whenever both exist.

## Interaction contract

- `/` focuses search; its query is debounced by 150 ms.
- Arrow keys move the active asset.
- `Space` opens Quick Look; `Esc` closes it and stops playback.
- `F` toggles favorite.
- `Ctrl/Cmd+A`, Shift-click, and Ctrl/Cmd-click provide multi-selection.
- `+` and `-` adjust thumbnail density.
- Dragging any selected card starts one native OS drag containing the real source paths.
- Dropping selected cards on a Collection adds references; it never moves files.
- Relinking a pack rewrites its root while preserving relative paths and asset metadata.

## Content and errors

UI copy is English and kept short enough for later localization. Errors state what failed and keep recovery nearby. Unsupported files are ignored during scanning rather than shown as broken assets. Missing supported files remain visible. Compatibility uses `Verified`, `Expected`, and `Unsupported` literally; it never promises universal editor support.

## Accessibility

All icon-only buttons require an accessible name or title. Keyboard focus uses the selection blue with a 2 px outline. Text and important state borders maintain strong contrast on graphite surfaces. Reduced-motion settings collapse animations to 1 ms. State is never communicated by color alone: icons, labels, borders, or text accompany it.
