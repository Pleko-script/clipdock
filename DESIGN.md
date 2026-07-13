# ClipDock design system

## Direction: Obsidian Edit Bay

ClipDock is a quiet staging surface between an effect library and a video editor. The visual language is deliberately neutral, dense, and media-first: near-black work surfaces, subtle gray layers, precise borders, and color reserved for state. It should feel like editing equipment, not a generic dashboard.

The memorable interaction is the clip range: a large video stage over one physical timeline with two explicit In and Out handles.

## Research principles

- Dark interfaces use progressively lighter neutral layers to establish depth instead of colored cards. This follows the [Carbon dark-theme layering model](https://carbondesignsystem.com/elements/color/overview/).
- Hierarchy comes from size, weight, and spacing. Avoiding tiny all-caps labels reduces visual noise, consistent with [Atlassian's typography guidance](https://atlassian.design/foundations/typography/applying-typography).
- The range control follows the [WAI-ARIA multi-thumb slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider-multithumb/): both thumbs remain in a constant tab order, expose their dependent limits, and support keyboard operation.
- Technical metadata uses progressive disclosure. The primary path stays visible; supporting file details remain one explicit action away.

## Visual tokens

| Token          | Value     | Use                                     |
| -------------- | --------- | --------------------------------------- |
| Background     | `#080909` | Global canvas                           |
| Layer 0        | `#0B0C0D` | Sidebar, toolbar, video editor          |
| Layer 1        | `#111214` | Cards, fields, quiet controls           |
| Layer 2        | `#17191B` | Selected navigation and raised controls |
| Hover          | `#1C1E20` | Interactive hover state                 |
| Subtle border  | `#25272A` | Structural division                     |
| Strong border  | `#393C40` | Hover and active control boundaries     |
| Primary text   | `#ECECEA` | Titles and values                       |
| Secondary text | `#A2A5A8` | Labels and supporting content           |
| Tertiary text  | `#6E7276` | Counts and low-priority context         |
| Favorite       | `#D7B768` | Favorite state only                     |
| Success        | `#78BC98` | Ready and verified states               |
| Warning        | `#C9A966` | Pending and expected states             |
| Error          | `#D9777F` | Missing media and failures              |

White-gray is the selection and focus accent. Blue is not part of the base interface. Surfaces are flat; decorative gradients, colored glows, and glass cards are not used.

## Typography

- **Commissioner Variable** is the UI family. Use weight and size for hierarchy rather than uppercase tracking.
- **Fragment Mono** is reserved for timecodes, durations, counts, codecs, and status output.
- The normal UI floor is 11–12 px. Primary asset and editor titles are 13–18 px.
- Labels use sentence case. ALL CAPS is limited to real format abbreviations such as MP4.

Both families are bundled locally. The UI never requires a network connection.

## Layout

- Sidebar: 214 px.
- Toolbar: 56 px.
- Filters: temporary toolbar popover; active values become removable chips and never reserve permanent grid width.
- Smart Collections: a separate sidebar group for named, dynamic views of the current library.
- Results bar: 31 px.
- Video editor: centered above the asset results and collapsible, without an internal scroll container.
- Editor columns: Organize on the left, media/range in the center, and file details on the right.
- Editor side panels: 220 px by default, independently resizable from 140 to 320 px, and independently collapsible to 36 px. Widths and collapse choices persist locally. Below 900 px of editor space, File details collapses automatically; below 720 px, both side panels collapse until more space is available.
- Grid: all remaining space below the editor, row-virtualized with 14 px gaps.
- Comparison tray: session-only overlay above the status bar; at most six ordered candidates, collapsible without changing grid measurements.
- Duplicate review: a library scope grouped by complete content hash; every row shows pack, relative path, and full source path.
- Application minimum: 900 × 600 px.

The editor hierarchy is fixed:

1. Asset identity.
2. Large adaptive media stage.
3. In/Out range.
4. Always-visible organize controls on the left.
5. Always-visible file details on the right.

Notes are not part of the current UI. Pack, codec, size, resolution, compatibility, reveal, and preview-rebuild controls live inside **File details**.

## Clip range

- Portrait and landscape video share a centered square stage between 230 and 480 px. `object-fit: contain` preserves the full frame before and after quarter-turn rotation.
- The player uses minimal custom playback and fullscreen controls.
- Left and right rotation controls move in 90-degree steps and display the current angle.
- Preview audio has a persistent volume slider and mute control; videos without audio show an explicit no-audio state.
- In and Out share one visible rail. There are never two separate slider tracks.
- Each thumb is a focusable ARIA slider with a visible timecode and a dependent min/max value.
- Pointer drag snaps to the source frame interval.
- Arrow keys move one frame; Page Up/Down move ten frames; Home/End move to the allowed boundary.
- Thumbs never cross and the range is at least 100 ms.
- Playback loops between In and Out.
- Applying a range or rotation renders a cached derivative without changing the source file.
- Opaque ranges use high-quality H.264 MP4. Alpha ranges use ProRes 4444 MOV.
- A prepared edit is dragged instead of the original; Reset restores original-file drag behavior.

## Audio preview

- Sounds use a responsive, cached waveform as the default selected-asset preview. A cached spectrogram is available as an optional view over the same transport.
- Clicking or dragging across either view seeks the source audio; the playhead and timecode remain synchronized.
- In and Out define a non-destructive audition loop. `I`, `O`, and `L` set its boundaries and toggle it; Space controls playback while the waveform has focus.
- Arrow keys seek by one percent, Shift+Arrow by five seconds, and Home/End move to the source boundaries.
- Preview volume persists across cards, the inspector, and Quick Look. Starting any sound preview stops the previous sound so only one is audible.
- Waveform and spectrogram cache names include source identity and preview-pipeline version, allowing source changes and renderer updates to create fresh artifacts.

## Language

- Every visible workflow string is centralized in `i18n.tsx`.
- English and German can be switched instantly from the sidebar.
- The selected language and preview volume are stored locally in the renderer profile.
- New copy must ship with both translations in the same change.

## Asset cards

Cards consist of a full-bleed preview and two text lines. The default card does not show codec, format, folder path, or an `unknown` type badge.

- Kind appears only when it adds information.
- Duration is the only persistent media overlay; a scissors icon marks a selected range.
- Favorite appears on hover or when active.
- Selection uses a neutral border, never a colored glow.
- Missing media and pending preview states remain explicit text states.
- Hover preview starts after 250 ms for video or 300 ms for sound. A video proxy warms during the delay, then horizontal pointer position scrubs its timeline without audio.
- No more than three video previews and one sound preview may be active at once.
- `P` starts or stops the same preview on a focused card without replacing Enter, Space, or arrow navigation.
- A frame chosen in the video editor can replace the generated card thumbnail. Reset restores the generated thumbnail; a changed source invalidates the custom frame.
- Compact card signals are limited to actionable readiness (preparing, failed, missing, unsupported) and media traits needed for placement (Alpha, portrait, audio). Codec and verbose format details remain in File details.
- Missing assets expose **Relink Pack** in place; failed previews expose **Retry preview**. Filtered empty states expose **Clear filters**, while a truly empty library points to pack import.
- Drag readiness is evaluated separately from preview readiness: a failed thumbnail does not block an otherwise ready original file. A requested trim or rotation blocks drag until its derivative is ready.

## Search and UCS metadata

- Search expands a reviewed, versioned set of German and English SFX equivalents locally. It is deterministic and never presented as AI or semantic search.
- A visible **Related / Exact** control appears when a recognized term is entered. Related mode names the included terms; Exact mode keeps the original FTS behavior without dictionary expansion.
- The dictionary covers whooshes, impacts, risers, ambience, glitches, transitions, and common Foley terms. UI language does not change the query expansion.
- UCS `CatID`, category, and subcategory values are read from format and stream tags. A valid four-block `CatID_FXName_CreatorID_SourceID` filename supplies CatID when embedded metadata is absent.
- Local round-trip checks with the bundled FFmpeg/FFprobe expose arbitrary UCS fields in FLAC and MP3. WAV, M4A, OGG, and raw AAC are treated as metadata-optional because equivalent generated samples did not reliably expose those custom fields.
- UCS values are stored in dedicated SQLite columns, included in full-text search, exposed as a filter, and shown in File details. Source files are never renamed or rewritten.

## Interaction contract

- `/` focuses search; search is debounced by 150 ms.
- Facet values use OR within one group and AND across groups; every visible option carries its current result count.
- Active filters remain visible as removable chips with one explicit **Clear all** action.
- Arrow keys move the active asset.
- `Space` opens Quick Look; `Esc` closes it and stops playback.
- `F` toggles favorite.
- `Ctrl/Cmd+A`, Shift-click, and Ctrl/Cmd-click provide multi-selection.
- `+` and `-` adjust thumbnail density.
- Card comparison actions add or remove a candidate without changing selection. When the comparison tray itself is focused, Left/Right moves between candidates and Space toggles playback.
- The active comparison candidate uses its contextual video proxy or waveform-backed source audio and can be dragged through the existing prepared-derivative path. Clear unmounts every tray media element.
- Native drag contains original paths or prepared edit paths where configured.
- Dropping on a Collection adds references and never moves source files.
- Saving a Smart Collection stores stable search, scope, filter, and sort keys; opening it evaluates those criteria against current asset data.
- Renaming, updating, or deleting a Smart Collection never changes source media or manual Collection membership.
- Linked packs are watched after startup, add, and relink. File bursts are debounced before affected paths are reconciled through the normal scan status model.
- A disconnected root keeps its pack and asset metadata unchanged. Reconnect performs one recovery scan; manual rescan remains available.
- Editor resize separators support Left/Right Arrow (8 px), Shift+Arrow (24 px), Home (140 px), and End (320 px). Collapse buttons and separators retain a visible keyboard focus outline.
- Background progress owns one stable status-bar slot. Routine success text clears after four seconds; failures remain until the next relevant action instead of creating stacked notifications.

## Exact duplicates

- Duplicate identity is a complete streamed SHA-256 of the original asset path. Filenames, previews, poster frames, and prepared trim/rotation files never participate.
- One persistent hash job runs at a time. A running job returns to pending after restart, and source size plus modification time invalidate a stored hash.
- Groups can span packs. The review view keeps every copy, including hidden ones, visible with its pack and source path.
- **Hide copy** changes only `duplicate_hidden` in SQLite. It never deletes, moves, renames, or rewrites the source and can always be reversed in the duplicate review.

## Anti-slop guardrails

- Do not add decorative pills, gradients, colored glows, or large rounded cards by default.
- Do not expose technical metadata before the primary media task.
- Do not repeat information across card, toolbar, and editor.
- Do not use disabled primary buttons as persistent status panels.
- Do not add new accent colors for asset categories.
- Do not shrink media to make secondary controls fit; secondary content scrolls or collapses.
- Every visible label must help selection, preview, organization, or recovery.

## Accessibility

- Every icon-only button has an accessible name.
- Keyboard focus uses a two-pixel neutral outline with at least 3:1 contrast.
- Slider values expose readable timecodes through `aria-valuetext`.
- State is communicated by text and icon in addition to color.
- Reduced-motion preference collapses transitions and animations to 1 ms.
