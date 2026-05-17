# Bins, Preview-First Layout, and Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build internal flat bins, a preview-first ClipDock layout, safe remove actions, and non-destructive 90-degree rotation with render-on-drag exports.

**Architecture:** Keep the renderer sandboxed behind the existing typed `window.clipdock` bridge. Persist bins, bin membership, rotation, and export cache state in SQLite. Resolve file paths and FFmpeg exports only in the Electron main process before native drag starts.

**Tech Stack:** Electron, React 19, TypeScript, SQLite via `node:sqlite`, FFmpeg via `ffmpeg-static`, Node test runner, Electron Vite.

---

## Scope Check

The approved spec contains one cohesive workflow package: library organization, preview-first browsing, and rotation-aware drag. In/out trimming, nested bins, source file moves, and source file deletes remain outside this plan.

## File Structure

- Modify `src/shared/clipdock.ts`: shared bin, rotation, export, snapshot, error, and API types.
- Modify `src/preload/index.ts`: typed IPC bridge methods for bins, clip removal, and rotation.
- Modify `src/preload/index.d.ts`: preload global type remains based on `ClipdockApi`.
- Modify `src/main/libraryStore.ts`: schema version, migrations, bin persistence, clip-bin joins, rotation persistence, clip removal, export cache records, and snapshot expansion.
- Modify `src/main/libraryIpc.ts`: IPC channels, validation, handlers, export cache directory, and rotation-aware drag path resolution.
- Create `src/main/rotatedExport.ts`: FFmpeg-backed rotated export service with cache reuse.
- Modify `src/renderer/src/App.tsx`: split the monolithic UI into hooks and components.
- Create `src/renderer/src/components/Sidebar.tsx`: navigation, tags, bins, import actions.
- Create `src/renderer/src/components/PreviewStage.tsx`: dominant video preview, compact metadata, rotation controls, primary clip actions.
- Create `src/renderer/src/components/ClipGrid.tsx`: clip cards, selection, drag start, context-menu entry points.
- Create `src/renderer/src/components/ContextMenu.tsx`: reusable right-click menu primitive.
- Create `src/renderer/src/hooks/useClipSelection.ts`: active clip and multi-select state.
- Modify `src/renderer/src/assets/main.css`: preview-first layout, bin/sidebar styles, menu styles, rotated preview transforms.
- Modify `test/mvp-contract.test.mjs`: contract and runtime coverage for the new workflow.
- Modify `README.md`: document bins, rotation, and safe remove behavior after the feature is implemented.

---

### Task 1: Expand The Shared Contract Test

**Files:**
- Modify: `test/mvp-contract.test.mjs`
- Modify next task: `src/shared/clipdock.ts`

- [ ] **Step 1: Add failing shared contract assertions**

In `test/mvp-contract.test.mjs`, extend `test('shared contract covers the requested ClipDock MVP features', ...)` with these surfaces:

```js
  for (const surface of [
    'LibraryBinRecordSummary',
    'ClipRotationDegrees',
    'binIds',
    'rotationDegrees',
    'bins',
    'createBin',
    'renameBin',
    'deleteBin',
    'addClipsToBin',
    'moveClipsToBin',
    'removeClipsFromBin',
    'removeClipsFromLibrary',
    'updateClipRotation'
  ]) {
    assert.match(shared, new RegExp(`\\b${surface}\\b`))
  }
```

Extend the preload test with these expected bridge methods:

```js
  for (const method of [
    'createBin',
    'renameBin',
    'deleteBin',
    'addClipsToBin',
    'moveClipsToBin',
    'removeClipsFromBin',
    'removeClipsFromLibrary',
    'updateClipRotation'
  ]) {
    assert.match(preload, new RegExp(`\\b${method}\\b`))
  }
```

Extend the SQLite store test with:

```js
  for (const table of ['bins', 'clip_bins', 'clip_exports']) {
    assert.match(store, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
  }

  for (const field of ['rotation_degrees', 'binIds', 'rotationDegrees']) {
    assert.match(store, new RegExp(`\\b${field}\\b`))
  }
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
npm run test:mvp
```

Expected: FAIL because the shared contract, preload bridge, and store do not yet expose bins, rotation, and export cache surfaces.

- [ ] **Step 3: Commit the failing contract expansion**

```bash
git add test/mvp-contract.test.mjs
git commit -m "test: specify bins and rotation contract"
```

---

### Task 2: Add Shared Types And API Methods

**Files:**
- Modify: `src/shared/clipdock.ts`
- Test: `test/mvp-contract.test.mjs`

- [ ] **Step 1: Add rotation, bin, and export shared types**

In `src/shared/clipdock.ts`, add these types near the existing library type aliases:

```ts
export type ClipRotationDegrees = 0 | 90 | 180 | 270

export interface LibraryBinRecordSummary {
  id: string
  name: string
  sortOrder: number
  clipCount: number
  createdAtMs: number
  updatedAtMs: number
}

export interface LibraryClipExportRecordSummary {
  id: string
  clipId: string
  variantKind: 'rotation'
  rotationDegrees: Exclude<ClipRotationDegrees, 0>
  sourceSizeBytes: number
  sourceModifiedAtMs: number
  exportPath: string
  createdAtMs: number
  updatedAtMs: number
}
```

- [ ] **Step 2: Extend error and phase unions**

Add these error codes to `ClipdockErrorCode`:

```ts
  | 'BIN_NOT_FOUND'
  | 'BIN_DUPLICATE_NAME'
  | 'BIN_UPDATE_FAILED'
  | 'CLIP_REMOVE_FAILED'
  | 'CLIP_EXPORT_FAILED'
```

Add these phases to `LibraryImportPhase`:

```ts
  | 'bin'
  | 'remove'
  | 'export'
```

- [ ] **Step 3: Extend clip and snapshot summaries**

Add these fields to `LibraryClipRecordSummary`:

```ts
  binIds: string[]
  rotationDegrees: ClipRotationDegrees
```

Add this field to `LibrarySnapshot`:

```ts
  bins: LibraryBinRecordSummary[]
```

- [ ] **Step 4: Extend `ClipdockApi`**

Add these methods to `ClipdockApi`:

```ts
  createBin: (name: string) => Promise<ClipdockResult<LibrarySnapshot>>
  renameBin: (binId: string, name: string) => Promise<ClipdockResult<LibrarySnapshot>>
  deleteBin: (binId: string) => Promise<ClipdockResult<LibrarySnapshot>>
  addClipsToBin: (
    clipIds: string[],
    binId: string
  ) => Promise<ClipdockResult<LibrarySnapshot>>
  moveClipsToBin: (
    clipIds: string[],
    fromBinId: string,
    toBinId: string
  ) => Promise<ClipdockResult<LibrarySnapshot>>
  removeClipsFromBin: (
    clipIds: string[],
    binId: string
  ) => Promise<ClipdockResult<LibrarySnapshot>>
  removeClipsFromLibrary: (clipIds: string[]) => Promise<ClipdockResult<LibrarySnapshot>>
  updateClipRotation: (
    clipId: string,
    rotationDegrees: ClipRotationDegrees
  ) => Promise<ClipdockResult<LibrarySnapshot>>
```

- [ ] **Step 5: Run the contract test**

Run:

```bash
npm run test:mvp
```

Expected: still FAIL because preload and store are not implemented.

- [ ] **Step 6: Commit shared contract types**

```bash
git add src/shared/clipdock.ts
git commit -m "feat: add bins and rotation shared contract"
```

---

### Task 3: Add Store Schema, Snapshot Fields, And Bin Read Models

**Files:**
- Modify: `src/main/libraryStore.ts`
- Test: `test/mvp-contract.test.mjs`

- [ ] **Step 1: Increase schema version and imports**

In `src/main/libraryStore.ts`, change:

```ts
const SCHEMA_VERSION = 3
```

Import the new shared types:

```ts
  type ClipRotationDegrees,
  type LibraryBinRecordSummary,
  type LibraryClipExportRecordSummary,
```

- [ ] **Step 2: Add row interfaces**

Add these row interfaces after `TagRow`:

```ts
interface BinRow {
  id: string
  name: string
  normalized_name: string
  sort_order: number
  created_at_ms: number
  updated_at_ms: number
  clip_count: number
}

interface ClipBinRow {
  clip_id: string
  bin_id: string
}

interface ClipExportRow {
  id: string
  clip_id: string
  variant_kind: 'rotation'
  rotation_degrees: Exclude<ClipRotationDegrees, 0>
  source_size_bytes: number
  source_modified_at_ms: number
  export_path: string
  normalized_export_path: string
  created_at_ms: number
  updated_at_ms: number
}
```

- [ ] **Step 3: Add schema SQL**

Inside `migrate()`, after `clip_tags`, add:

```sql
        CREATE TABLE IF NOT EXISTS bins (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL UNIQUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS clip_bins (
          clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
          bin_id TEXT NOT NULL REFERENCES bins(id) ON DELETE CASCADE,
          created_at_ms INTEGER NOT NULL,
          PRIMARY KEY (clip_id, bin_id)
        );

        CREATE TABLE IF NOT EXISTS clip_exports (
          id TEXT PRIMARY KEY,
          clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
          variant_kind TEXT NOT NULL CHECK (variant_kind IN ('rotation')),
          rotation_degrees INTEGER NOT NULL CHECK (rotation_degrees IN (90, 180, 270)),
          source_size_bytes INTEGER NOT NULL,
          source_modified_at_ms INTEGER NOT NULL,
          export_path TEXT NOT NULL,
          normalized_export_path TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          UNIQUE (
            clip_id,
            variant_kind,
            rotation_degrees,
            source_size_bytes,
            source_modified_at_ms
          )
        );
```

Add indexes:

```sql
        CREATE INDEX IF NOT EXISTS idx_bins_sort_order
          ON bins(sort_order, name);
        CREATE INDEX IF NOT EXISTS idx_clip_bins_clip_id
          ON clip_bins(clip_id);
        CREATE INDEX IF NOT EXISTS idx_clip_bins_bin_id
          ON clip_bins(bin_id);
        CREATE INDEX IF NOT EXISTS idx_clip_exports_clip_variant
          ON clip_exports(clip_id, variant_kind, rotation_degrees);
```

Add the rotation migration near the existing `ensureColumn` calls:

```ts
      ensureColumn(
        this.database,
        'clips',
        'rotation_degrees',
        'rotation_degrees INTEGER NOT NULL DEFAULT 0 CHECK (rotation_degrees IN (0, 90, 180, 270))'
      )
```

- [ ] **Step 4: Extend `ClipRow` and summary conversion**

Add to `ClipRow`:

```ts
  rotation_degrees: ClipRotationDegrees
```

Change `clipSummaryFromRow` signature to:

```ts
function clipSummaryFromRow(
  row: ClipRow,
  tags: string[],
  binIds: string[] = []
): LibraryClipRecordSummary {
```

Add to the returned object:

```ts
    binIds,
    rotationDegrees: row.rotation_degrees,
```

Add a converter:

```ts
function binSummaryFromRow(row: BinRow): LibraryBinRecordSummary {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    clipCount: row.clip_count,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  }
}
```

- [ ] **Step 5: Read bin assignments for snapshots**

Add this private method:

```ts
  private readBinIdsByClipId(): Map<string, string[]> {
    const rows = this.database
      .prepare(
        `SELECT clip_id, bin_id
           FROM clip_bins
          ORDER BY created_at_ms ASC, bin_id ASC`
      )
      .all() as ClipBinRow[]
    const byClipId = new Map<string, string[]>()

    for (const row of rows) {
      const ids = byClipId.get(row.clip_id) ?? []
      ids.push(row.bin_id)
      byClipId.set(row.clip_id, ids)
    }

    return byClipId
  }
```

Add this private method:

```ts
  private readBins(): BinRow[] {
    return this.database
      .prepare(
        `SELECT b.*, COUNT(cb.clip_id) AS clip_count
           FROM bins b
           LEFT JOIN clip_bins cb ON cb.bin_id = b.id
           LEFT JOIN clips c ON c.id = cb.clip_id AND c.status != 'removed'
          GROUP BY b.id
          ORDER BY b.sort_order ASC, b.name COLLATE NOCASE ASC`
      )
      .all() as BinRow[]
  }
```

Update `snapshot()` so it builds `bins` and passes bin IDs into clip summaries:

```ts
      const binRows = this.readBins()
      const binIdsByClipId = this.readBinIdsByClipId()

      return ok({
        generatedAtMs: nowMs(this.now),
        sources: sourceRows.map(sourceSummaryFromRow),
        bins: binRows.map(binSummaryFromRow),
        clips: clipRows.map((row) =>
          clipSummaryFromRow(row, tagsByClipId.get(row.id) ?? [], binIdsByClipId.get(row.id) ?? [])
        )
      })
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm run test:mvp
npm run typecheck:node
```

Expected: `test:mvp` still fails on missing store and preload methods. `typecheck:node` may fail until the `LibraryStore` interface methods are added in the next tasks.

- [ ] **Step 7: Commit schema and read models**

```bash
git add src/main/libraryStore.ts
git commit -m "feat: persist bins and rotation fields"
```

---

### Task 4: Implement Store Bin Operations

**Files:**
- Modify: `src/main/libraryStore.ts`
- Test: `test/mvp-contract.test.mjs`

- [ ] **Step 1: Add runtime test coverage**

In `test/mvp-contract.test.mjs`, add a runtime test near the existing scanner runtime test:

```js
test('library store creates bins and assigns one clip to multiple bins', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-bins-runtime-'))
  const databaseFile = join(workspace, 'db', 'library.sqlite')
  const libraryDir = join(workspace, 'library')
  const mediaDir = join(workspace, 'media')
  mkdirSync(mediaDir, { recursive: true })
  const videoFile = join(mediaDir, 'sample.mp4')
  writeFileSync(videoFile, 'not a real video for store-only assignment')

  const { storeModule } = compileRuntimeModules()
  const opened = storeModule.openLibraryStore({
    databaseFile,
    libraryDir,
    now: () => 1000,
    createId: (() => {
      let count = 0
      return () => `id-${++count}`
    })()
  })

  assert.equal(opened.ok, true)
  const store = opened.value
  const copied = store.createCopiedClipRecord({ sourceFile: videoFile, managedFile: videoFile })
  assert.equal(copied.ok, true)
  const clipId = copied.value.clip.id

  const first = store.createBin('B-Roll')
  assert.equal(first.ok, true)
  const second = store.createBin('Social')
  assert.equal(second.ok, true)

  const assignedFirst = store.addClipsToBin([clipId], first.value.bins[0].id)
  assert.equal(assignedFirst.ok, true)
  const assignedSecond = store.addClipsToBin([clipId], second.value.bins[1].id)
  assert.equal(assignedSecond.ok, true)

  const snapshot = store.snapshot()
  assert.equal(snapshot.ok, true)
  const expectedBinIds = snapshot.value.bins.map((bin) => bin.id).sort()
  assert.deepEqual([...snapshot.value.clips[0].binIds].sort(), expectedBinIds)
  assert.equal(snapshot.value.bins[0].clipCount, 1)
  assert.equal(snapshot.value.bins[1].clipCount, 1)
  store.close()
  rmSync(workspace, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run test:mvp
```

Expected: FAIL because `createBin` and `addClipsToBin` do not exist on the store.

- [ ] **Step 3: Add bin helper functions**

In `src/main/libraryStore.ts`, add:

```ts
function normalizeBinKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function boundedBinName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 80)
}

function validClipIds(value: string[]): string[] {
  return [...new Set(value.map((id) => id.trim()).filter(Boolean))].slice(0, 256)
}
```

- [ ] **Step 4: Extend `LibraryStore` interface**

Add methods:

```ts
  createBin: (name: string) => LibraryResult<LibrarySnapshot>
  renameBin: (binId: string, name: string) => LibraryResult<LibrarySnapshot>
  deleteBin: (binId: string) => LibraryResult<LibrarySnapshot>
  addClipsToBin: (clipIds: string[], binId: string) => LibraryResult<LibrarySnapshot>
  moveClipsToBin: (
    clipIds: string[],
    fromBinId: string,
    toBinId: string
  ) => LibraryResult<LibrarySnapshot>
  removeClipsFromBin: (clipIds: string[], binId: string) => LibraryResult<LibrarySnapshot>
```

- [ ] **Step 5: Implement bin methods in `SqliteLibraryStore`**

Add these methods near existing update methods:

```ts
  createBin(name: string): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('bin')
    if (!openResult.ok) return openResult

    const cleanName = boundedBinName(name)
    const normalizedName = normalizeBinKey(cleanName)
    if (!normalizedName) {
      return fail('LIBRARY_INVALID_INPUT', 'bin', 'A bin name is required.')
    }

    try {
      const timestamp = nowMs(this.now)
      const maxSort = this.database
        .prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM bins')
        .get() as { value: number }
      this.database
        .prepare(
          `INSERT INTO bins (id, name, normalized_name, sort_order, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(this.createId(), cleanName, normalizedName, maxSort.value + 1, timestamp, timestamp)
      return this.snapshot()
    } catch {
      return fail('BIN_DUPLICATE_NAME', 'bin', 'A bin with that name already exists.')
    }
  }

  renameBin(binId: string, name: string): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('bin')
    if (!openResult.ok) return openResult

    const cleanName = boundedBinName(name)
    const normalizedName = normalizeBinKey(cleanName)
    if (!binId.trim() || !normalizedName) {
      return fail('LIBRARY_INVALID_INPUT', 'bin', 'A valid bin id and name are required.')
    }

    try {
      const result = this.database
        .prepare('UPDATE bins SET name = ?, normalized_name = ?, updated_at_ms = ? WHERE id = ?')
        .run(cleanName, normalizedName, nowMs(this.now), binId)
      if (result.changes === 0) return fail('BIN_NOT_FOUND', 'bin', 'The selected bin was not found.')
      return this.snapshot()
    } catch {
      return fail('BIN_DUPLICATE_NAME', 'bin', 'A bin with that name already exists.')
    }
  }

  deleteBin(binId: string): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('bin')
    if (!openResult.ok) return openResult

    try {
      const result = this.database.prepare('DELETE FROM bins WHERE id = ?').run(binId)
      if (result.changes === 0) return fail('BIN_NOT_FOUND', 'bin', 'The selected bin was not found.')
      return this.snapshot()
    } catch {
      return fail('BIN_UPDATE_FAILED', 'bin', 'ClipDock could not delete the bin.')
    }
  }

  addClipsToBin(clipIds: string[], binId: string): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('bin')
    if (!openResult.ok) return openResult

    const ids = validClipIds(clipIds)
    if (ids.length === 0 || !binId.trim()) {
      return fail('LIBRARY_INVALID_INPUT', 'bin', 'Select clips and a bin first.')
    }
    if (!this.readBinById(binId)) return fail('BIN_NOT_FOUND', 'bin', 'The selected bin was not found.')

    try {
      const timestamp = nowMs(this.now)
      const insert = this.database.prepare(
        'INSERT OR IGNORE INTO clip_bins (clip_id, bin_id, created_at_ms) VALUES (?, ?, ?)'
      )
      this.database.exec('BEGIN IMMEDIATE')
      for (const clipId of ids) {
        if (!this.readClipById(clipId)) {
          safeRollback(this.database)
          return fail('CLIP_NOT_FOUND', 'bin', 'One selected clip is no longer in the library.')
        }
        insert.run(clipId, binId, timestamp)
      }
      this.database.exec('COMMIT')
      return this.snapshot()
    } catch {
      safeRollback(this.database)
      return fail('BIN_UPDATE_FAILED', 'bin', 'ClipDock could not assign clips to the bin.')
    }
  }
```

Add `moveClipsToBin` and `removeClipsFromBin`:

```ts
  moveClipsToBin(
    clipIds: string[],
    fromBinId: string,
    toBinId: string
  ): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('bin')
    if (!openResult.ok) return openResult
    const ids = validClipIds(clipIds)
    if (ids.length === 0 || !fromBinId.trim() || !toBinId.trim()) {
      return fail('LIBRARY_INVALID_INPUT', 'bin', 'Select clips and bins first.')
    }
    if (!this.readBinById(fromBinId) || !this.readBinById(toBinId)) {
      return fail('BIN_NOT_FOUND', 'bin', 'The selected bin was not found.')
    }

    try {
      const timestamp = nowMs(this.now)
      this.database.exec('BEGIN IMMEDIATE')
      for (const clipId of ids) {
        this.database.prepare('DELETE FROM clip_bins WHERE clip_id = ? AND bin_id = ?').run(clipId, fromBinId)
        this.database
          .prepare('INSERT OR IGNORE INTO clip_bins (clip_id, bin_id, created_at_ms) VALUES (?, ?, ?)')
          .run(clipId, toBinId, timestamp)
      }
      this.database.exec('COMMIT')
      return this.snapshot()
    } catch {
      safeRollback(this.database)
      return fail('BIN_UPDATE_FAILED', 'bin', 'ClipDock could not move clips between bins.')
    }
  }

  removeClipsFromBin(clipIds: string[], binId: string): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('bin')
    if (!openResult.ok) return openResult
    const ids = validClipIds(clipIds)
    if (ids.length === 0 || !binId.trim()) {
      return fail('LIBRARY_INVALID_INPUT', 'bin', 'Select clips and a bin first.')
    }

    try {
      const remove = this.database.prepare('DELETE FROM clip_bins WHERE clip_id = ? AND bin_id = ?')
      for (const clipId of ids) remove.run(clipId, binId)
      return this.snapshot()
    } catch {
      return fail('BIN_UPDATE_FAILED', 'bin', 'ClipDock could not remove clips from the bin.')
    }
  }
```

Add private helper:

```ts
  private readBinById(binId: string): BinRow | null {
    return (
      (this.database.prepare('SELECT *, 0 AS clip_count FROM bins WHERE id = ?').get(binId) as
        | BinRow
        | undefined) ?? null
    )
  }
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm run test:mvp
npm run typecheck:node
```

Expected: store bin tests pass or fail only on downstream missing APIs. Fix type errors in `libraryStore.ts` before committing.

- [ ] **Step 7: Commit store bin operations**

```bash
git add src/main/libraryStore.ts test/mvp-contract.test.mjs
git commit -m "feat: add library bin operations"
```

---

### Task 5: Implement Clip Removal And Rotation Persistence

**Files:**
- Modify: `src/main/libraryStore.ts`
- Test: `test/mvp-contract.test.mjs`

- [ ] **Step 1: Add runtime test**

Add this test:

```js
test('library store removes clips from ClipDock and stores valid rotations only', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-rotation-runtime-'))
  const databaseFile = join(workspace, 'db', 'library.sqlite')
  const libraryDir = join(workspace, 'library')
  const mediaDir = join(workspace, 'media')
  mkdirSync(mediaDir, { recursive: true })
  const videoFile = join(mediaDir, 'sample.mp4')
  writeFileSync(videoFile, 'store-only video')

  const { storeModule } = compileRuntimeModules()
  const opened = storeModule.openLibraryStore({ databaseFile, libraryDir })
  assert.equal(opened.ok, true)
  const store = opened.value
  const copied = store.createCopiedClipRecord({ sourceFile: videoFile, managedFile: videoFile })
  assert.equal(copied.ok, true)
  const clipId = copied.value.clip.id

  const rotated = store.updateClipRotation(clipId, 90)
  assert.equal(rotated.ok, true)
  assert.equal(rotated.value.clips[0].rotationDegrees, 90)

  const invalid = store.updateClipRotation(clipId, 45)
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, 'LIBRARY_INVALID_INPUT')

  const removed = store.removeClipsFromLibrary([clipId])
  assert.equal(removed.ok, true)
  assert.equal(removed.value.clips.length, 0)
  assert.equal(existsSync(videoFile), true)
  store.close()
  rmSync(workspace, { recursive: true, force: true })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run test:mvp
```

Expected: FAIL because `updateClipRotation` and `removeClipsFromLibrary` do not exist.

- [ ] **Step 3: Add store methods**

Extend `LibraryStore`:

```ts
  removeClipsFromLibrary: (clipIds: string[]) => LibraryResult<LibrarySnapshot>
  updateClipRotation: (
    clipId: string,
    rotationDegrees: ClipRotationDegrees
  ) => LibraryResult<LibrarySnapshot>
```

Add helper:

```ts
function isClipRotationDegrees(value: unknown): value is ClipRotationDegrees {
  return value === 0 || value === 90 || value === 180 || value === 270
}
```

Implement:

```ts
  removeClipsFromLibrary(clipIds: string[]): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('remove')
    if (!openResult.ok) return openResult

    const ids = validClipIds(clipIds)
    if (ids.length === 0) {
      return fail('LIBRARY_INVALID_INPUT', 'remove', 'Select at least one clip to remove.')
    }

    try {
      const timestamp = nowMs(this.now)
      this.database.exec('BEGIN IMMEDIATE')
      for (const clipId of ids) {
        this.database.prepare('DELETE FROM clip_bins WHERE clip_id = ?').run(clipId)
        this.database.prepare('DELETE FROM clip_search WHERE clip_id = ?').run(clipId)
        this.database
          .prepare('UPDATE clips SET status = ?, updated_at_ms = ? WHERE id = ?')
          .run('removed', timestamp, clipId)
      }
      this.database.exec('COMMIT')
      return this.snapshot()
    } catch {
      safeRollback(this.database)
      return fail('CLIP_REMOVE_FAILED', 'remove', 'ClipDock could not remove the selected clips.')
    }
  }

  updateClipRotation(
    clipId: string,
    rotationDegrees: ClipRotationDegrees
  ): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('update')
    if (!openResult.ok) return openResult
    if (!clipId.trim() || !isClipRotationDegrees(rotationDegrees)) {
      return fail('LIBRARY_INVALID_INPUT', 'update', 'A valid clip id and rotation are required.')
    }
    if (!this.readClipById(clipId)) {
      return fail('CLIP_NOT_FOUND', 'update', 'The selected clip is no longer in the library.')
    }

    try {
      this.database
        .prepare('UPDATE clips SET rotation_degrees = ?, updated_at_ms = ? WHERE id = ?')
        .run(rotationDegrees, nowMs(this.now), clipId)
      return this.snapshot()
    } catch {
      return fail('CLIP_UPDATE_FAILED', 'update', 'ClipDock could not update clip rotation.')
    }
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npm run test:mvp
npm run typecheck:node
```

Expected: store runtime coverage passes. Contract may still fail on preload and renderer surfaces.

- [ ] **Step 5: Commit**

```bash
git add src/main/libraryStore.ts test/mvp-contract.test.mjs
git commit -m "feat: store clip removal and rotation"
```

---

### Task 6: Add Preload And IPC Methods For Bins, Removal, And Rotation

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/main/libraryIpc.ts`
- Test: `test/mvp-contract.test.mjs`

- [ ] **Step 1: Add IPC channel constants**

In both `src/preload/index.ts` and `src/main/libraryIpc.ts`, add:

```ts
const CREATE_BIN_CHANNEL = 'clipdock:bin:create'
const RENAME_BIN_CHANNEL = 'clipdock:bin:rename'
const DELETE_BIN_CHANNEL = 'clipdock:bin:delete'
const ADD_CLIPS_TO_BIN_CHANNEL = 'clipdock:bin:add-clips'
const MOVE_CLIPS_TO_BIN_CHANNEL = 'clipdock:bin:move-clips'
const REMOVE_CLIPS_FROM_BIN_CHANNEL = 'clipdock:bin:remove-clips'
const REMOVE_CLIPS_FROM_LIBRARY_CHANNEL = 'clipdock:clip:remove-from-library'
const UPDATE_CLIP_ROTATION_CHANNEL = 'clipdock:clip:update-rotation'
```

Add all invoke channels to `LIBRARY_INVOKE_CHANNELS` in `libraryIpc.ts`.

- [ ] **Step 2: Add preload bridge methods**

In `src/preload/index.ts`, import `ClipRotationDegrees` and add these methods to `clipdock`:

```ts
  createBin: (name: string): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(CREATE_BIN_CHANNEL, 'ClipDock could not create the bin.', name)
  },
  renameBin: (binId: string, name: string): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(
      RENAME_BIN_CHANNEL,
      'ClipDock could not rename the bin.',
      binId,
      name
    )
  },
  deleteBin: (binId: string): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(DELETE_BIN_CHANNEL, 'ClipDock could not delete the bin.', binId)
  },
  addClipsToBin: (clipIds: string[], binId: string): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(
      ADD_CLIPS_TO_BIN_CHANNEL,
      'ClipDock could not add clips to the bin.',
      Array.isArray(clipIds) ? clipIds.slice(0, 256) : [],
      binId
    )
  },
  moveClipsToBin: (
    clipIds: string[],
    fromBinId: string,
    toBinId: string
  ): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(
      MOVE_CLIPS_TO_BIN_CHANNEL,
      'ClipDock could not move clips between bins.',
      Array.isArray(clipIds) ? clipIds.slice(0, 256) : [],
      fromBinId,
      toBinId
    )
  },
  removeClipsFromBin: (
    clipIds: string[],
    binId: string
  ): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(
      REMOVE_CLIPS_FROM_BIN_CHANNEL,
      'ClipDock could not remove clips from the bin.',
      Array.isArray(clipIds) ? clipIds.slice(0, 256) : [],
      binId
    )
  },
  removeClipsFromLibrary: (clipIds: string[]): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(
      REMOVE_CLIPS_FROM_LIBRARY_CHANNEL,
      'ClipDock could not remove clips from the library.',
      Array.isArray(clipIds) ? clipIds.slice(0, 256) : []
    )
  },
  updateClipRotation: (
    clipId: string,
    rotationDegrees: ClipRotationDegrees
  ): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(
      UPDATE_CLIP_ROTATION_CHANNEL,
      'ClipDock could not update clip rotation.',
      clipId,
      rotationDegrees
    )
  },
```

- [ ] **Step 3: Add IPC input validators**

In `src/main/libraryIpc.ts`, add:

```ts
function validClipIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
        .slice(0, 256)
    : []
}

function validText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function validRotation(value: unknown): 0 | 90 | 180 | 270 | null {
  return value === 0 || value === 90 || value === 180 || value === 270 ? value : null
}
```

- [ ] **Step 4: Register IPC handlers**

Add handlers beside existing update handlers:

```ts
  resolvedDependencies.ipcMain.handle(CREATE_BIN_CHANNEL, (_event, name: unknown) =>
    updateSnapshot(ensureRuntime, (store) => store.createBin(validText(name)))
  )
  resolvedDependencies.ipcMain.handle(RENAME_BIN_CHANNEL, (_event, binId: unknown, name: unknown) => {
    const id = validClipId(binId)
    return id
      ? updateSnapshot(ensureRuntime, (store) => store.renameBin(id, validText(name)))
      : fail('LIBRARY_INVALID_INPUT', 'A valid bin id is required.', { phase: 'bin' })
  })
  resolvedDependencies.ipcMain.handle(DELETE_BIN_CHANNEL, (_event, binId: unknown) => {
    const id = validClipId(binId)
    return id
      ? updateSnapshot(ensureRuntime, (store) => store.deleteBin(id))
      : fail('LIBRARY_INVALID_INPUT', 'A valid bin id is required.', { phase: 'bin' })
  })
  resolvedDependencies.ipcMain.handle(ADD_CLIPS_TO_BIN_CHANNEL, (_event, clipIds: unknown, binId: unknown) => {
    const id = validClipId(binId)
    return id
      ? updateSnapshot(ensureRuntime, (store) => store.addClipsToBin(validClipIds(clipIds), id))
      : fail('LIBRARY_INVALID_INPUT', 'A valid bin id is required.', { phase: 'bin' })
  })
  resolvedDependencies.ipcMain.handle(
    MOVE_CLIPS_TO_BIN_CHANNEL,
    (_event, clipIds: unknown, fromBinId: unknown, toBinId: unknown) => {
      const fromId = validClipId(fromBinId)
      const toId = validClipId(toBinId)
      return fromId && toId
        ? updateSnapshot(ensureRuntime, (store) =>
            store.moveClipsToBin(validClipIds(clipIds), fromId, toId)
          )
        : fail('LIBRARY_INVALID_INPUT', 'Valid source and target bin ids are required.', {
            phase: 'bin'
          })
    }
  )
  resolvedDependencies.ipcMain.handle(REMOVE_CLIPS_FROM_BIN_CHANNEL, (_event, clipIds: unknown, binId: unknown) => {
    const id = validClipId(binId)
    return id
      ? updateSnapshot(ensureRuntime, (store) => store.removeClipsFromBin(validClipIds(clipIds), id))
      : fail('LIBRARY_INVALID_INPUT', 'A valid bin id is required.', { phase: 'bin' })
  })
  resolvedDependencies.ipcMain.handle(REMOVE_CLIPS_FROM_LIBRARY_CHANNEL, (_event, clipIds: unknown) =>
    updateSnapshot(ensureRuntime, (store) => store.removeClipsFromLibrary(validClipIds(clipIds)))
  )
  resolvedDependencies.ipcMain.handle(UPDATE_CLIP_ROTATION_CHANNEL, (_event, clipId: unknown, rotation: unknown) => {
    const id = validClipId(clipId)
    const degrees = validRotation(rotation)
    return id && degrees !== null
      ? updateSnapshot(ensureRuntime, (store) => store.updateClipRotation(id, degrees))
      : fail('LIBRARY_INVALID_INPUT', 'A valid clip id and rotation are required.', {
          phase: 'update'
        })
  })
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm run test:mvp
npm run typecheck
```

Expected: contract tests for shared/preload/store pass. Renderer tests may still fail until UI surfaces are added.

- [ ] **Step 6: Commit**

```bash
git add src/preload/index.ts src/main/libraryIpc.ts test/mvp-contract.test.mjs
git commit -m "feat: expose bins and rotation ipc"
```

---

### Task 7: Add Rotated Export Service And Cache Persistence

**Files:**
- Create: `src/main/rotatedExport.ts`
- Modify: `src/main/libraryStore.ts`
- Modify: `src/main/libraryIpc.ts`
- Modify: `test/mvp-contract.test.mjs`

- [ ] **Step 1: Add store export interfaces and methods**

In `src/main/libraryStore.ts`, add:

```ts
export interface ClipExportInput {
  clipId: string
  rotationDegrees: Exclude<ClipRotationDegrees, 0>
  sourceSizeBytes: number
  sourceModifiedAtMs: number
}

export interface UpsertClipExportInput extends ClipExportInput {
  exportPath: string
}
```

Extend `LibraryStore`:

```ts
  getClipRotationExport: (
    input: ClipExportInput
  ) => LibraryResult<LibraryClipExportRecordSummary | null>
  upsertClipRotationExport: (
    input: UpsertClipExportInput
  ) => LibraryResult<LibraryClipExportRecordSummary>
```

Add converter:

```ts
function clipExportSummaryFromRow(row: ClipExportRow): LibraryClipExportRecordSummary {
  return {
    id: row.id,
    clipId: row.clip_id,
    variantKind: row.variant_kind,
    rotationDegrees: row.rotation_degrees,
    sourceSizeBytes: row.source_size_bytes,
    sourceModifiedAtMs: row.source_modified_at_ms,
    exportPath: row.export_path,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  }
}
```

Implement the methods:

```ts
  getClipRotationExport(
    input: ClipExportInput
  ): LibraryResult<LibraryClipExportRecordSummary | null> {
    const openResult = this.requireOpen('export')
    if (!openResult.ok) return openResult

    const row = this.database
      .prepare(
        `SELECT *
           FROM clip_exports
          WHERE clip_id = ?
            AND variant_kind = 'rotation'
            AND rotation_degrees = ?
            AND source_size_bytes = ?
            AND source_modified_at_ms = ?`
      )
      .get(
        input.clipId,
        input.rotationDegrees,
        input.sourceSizeBytes,
        input.sourceModifiedAtMs
      ) as ClipExportRow | undefined

    return ok(row ? clipExportSummaryFromRow(row) : null)
  }

  upsertClipRotationExport(input: UpsertClipExportInput): LibraryResult<LibraryClipExportRecordSummary> {
    const openResult = this.requireOpen('export')
    if (!openResult.ok) return openResult

    try {
      const timestamp = nowMs(this.now)
      const existing = this.getClipRotationExport(input)
      if (!existing.ok) return existing
      const exportId = existing.value?.id ?? this.createId()
      this.database
        .prepare(
          `INSERT INTO clip_exports (
             id, clip_id, variant_kind, rotation_degrees, source_size_bytes,
             source_modified_at_ms, export_path, normalized_export_path,
             created_at_ms, updated_at_ms
           )
           VALUES (?, ?, 'rotation', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (
             clip_id, variant_kind, rotation_degrees, source_size_bytes, source_modified_at_ms
           )
           DO UPDATE SET
             export_path = excluded.export_path,
             normalized_export_path = excluded.normalized_export_path,
             updated_at_ms = excluded.updated_at_ms`
        )
        .run(
          exportId,
          input.clipId,
          input.rotationDegrees,
          input.sourceSizeBytes,
          input.sourceModifiedAtMs,
          input.exportPath,
          normalizeRuntimeLocation(input.exportPath),
          existing.value?.createdAtMs ?? timestamp,
          timestamp
        )
      const saved = this.getClipRotationExport(input)
      if (!saved.ok || !saved.value) {
        return fail('CLIP_EXPORT_FAILED', 'export', 'ClipDock could not reload the export record.')
      }
      return saved
    } catch {
      return fail('CLIP_EXPORT_FAILED', 'export', 'ClipDock could not save the export record.')
    }
  }
```

- [ ] **Step 2: Create `src/main/rotatedExport.ts`**

Add:

```ts
import { createHash } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import type { ClipRotationDegrees, LibraryResult } from '../shared/clipdock'
import type { LibraryStore } from './libraryStore'

const requireFromMain = createRequire(import.meta.url)
const ffmpegPath = requireFromMain('ffmpeg-static') as string | null
const ROTATION_TIMEOUT_MS = 10 * 60 * 1000

export interface ResolveRotatedExportInput {
  store: LibraryStore
  clipId: string
  sourcePath: string
  sourceSizeBytes: number
  sourceModifiedAtMs: number
  rotationDegrees: ClipRotationDegrees
  exportCacheDir: string
}

function ok<T>(value: T): LibraryResult<T> {
  return { ok: true, value }
}

function fail<T>(message: string): LibraryResult<T> {
  return { ok: false, error: { code: 'CLIP_EXPORT_FAILED', phase: 'export', message } }
}

function filterForRotation(rotationDegrees: Exclude<ClipRotationDegrees, 0>): string {
  if (rotationDegrees === 90) return 'transpose=1'
  if (rotationDegrees === 180) return 'transpose=1,transpose=1'
  return 'transpose=2'
}

function exportName(input: ResolveRotatedExportInput): string {
  const hash = createHash('sha256')
    .update(input.clipId)
    .update(String(input.rotationDegrees))
    .update(String(input.sourceSizeBytes))
    .update(String(input.sourceModifiedAtMs))
    .digest('hex')
    .slice(0, 24)
  return `${hash}-rot${input.rotationDegrees}.mp4`
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)
    return stats.isFile()
  } catch {
    return false
  }
}

async function renderRotation(
  sourcePath: string,
  outputPath: string,
  rotationDegrees: Exclude<ClipRotationDegrees, 0>
): Promise<LibraryResult<void>> {
  if (!ffmpegPath) return fail('FFmpeg is not available for rotated exports.')
  await mkdir(dirname(outputPath), { recursive: true })

  const args = [
    '-y',
    '-i',
    sourcePath,
    '-vf',
    filterForRotation(rotationDegrees),
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    outputPath
  ]

  return await new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    const errorChunks: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(fail('Rotated export timed out.'))
    }, ROTATION_TIMEOUT_MS)

    child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(fail('Rotated export could not be started.'))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(ok(undefined))
      else resolve(fail(Buffer.concat(errorChunks).toString('utf8') || 'Rotated export failed.'))
    })
  })
}

export async function resolveRotatedExportPath(
  input: ResolveRotatedExportInput
): Promise<LibraryResult<string>> {
  if (input.rotationDegrees === 0) return ok(input.sourcePath)

  const rotationDegrees = input.rotationDegrees as Exclude<ClipRotationDegrees, 0>
  const cached = input.store.getClipRotationExport({
    clipId: input.clipId,
    rotationDegrees,
    sourceSizeBytes: input.sourceSizeBytes,
    sourceModifiedAtMs: input.sourceModifiedAtMs
  })
  if (!cached.ok) return cached
  if (cached.value && (await fileExists(cached.value.exportPath))) return ok(cached.value.exportPath)

  const outputPath = join(input.exportCacheDir, exportName(input))
  const rendered = await renderRotation(input.sourcePath, outputPath, rotationDegrees)
  if (!rendered.ok) return rendered

  const saved = input.store.upsertClipRotationExport({
    clipId: input.clipId,
    rotationDegrees,
    sourceSizeBytes: input.sourceSizeBytes,
    sourceModifiedAtMs: input.sourceModifiedAtMs,
    exportPath: outputPath
  })
  return saved.ok ? ok(saved.value.exportPath) : saved
}
```

- [ ] **Step 3: Add export cache directory to IPC storage**

In `src/main/libraryIpc.ts`, add:

```ts
const EXPORT_CACHE_DIRNAME = 'exports'
```

Extend `LibraryStorageLocations`:

```ts
  exportCacheDir: string
```

Set it in `resolveLibraryStorage()`:

```ts
      exportCacheDir: join(libraryRoot, EXPORT_CACHE_DIRNAME)
```

Add mkdir in `ensureManagedLibraryDirectory()`:

```ts
    await dependencies.fs.mkdir(storage.exportCacheDir, { recursive: true })
```

- [ ] **Step 4: Run node typecheck**

Run:

```bash
npm run typecheck:node
```

Expected: PASS after fixing imports and type names.

- [ ] **Step 5: Commit**

```bash
git add src/main/rotatedExport.ts src/main/libraryStore.ts src/main/libraryIpc.ts
git commit -m "feat: add rotated export cache service"
```

---

### Task 8: Integrate Rotation-Aware Native Drag

**Files:**
- Modify: `src/main/libraryStore.ts`
- Modify: `src/main/libraryIpc.ts`
- Test: `test/mvp-contract.test.mjs`

- [ ] **Step 1: Expose export-ready clip data from store**

In `src/main/libraryStore.ts`, add:

```ts
export interface ClipDragAsset {
  id: string
  filePath: string
  sizeBytes: number
  modifiedAtMs: number
  rotationDegrees: ClipRotationDegrees
}
```

Extend `LibraryStore`:

```ts
  getClipDragAsset: (clipId: string) => LibraryResult<ClipDragAsset>
```

Implement:

```ts
  getClipDragAsset(clipId: string): LibraryResult<ClipDragAsset> {
    const openResult = this.requireOpen('drag')
    if (!openResult.ok) return openResult

    const row = this.readClipById(clipId)
    if (!row || row.status === 'removed') {
      return fail('CLIP_NOT_FOUND', 'drag', 'The selected clip is no longer in the library.')
    }
    const filePath = actualClipPath(row)
    if (!filePath) return fail('ASSET_NOT_FOUND', 'drag', 'The selected clip asset is not available.')

    return ok({
      id: row.id,
      filePath,
      sizeBytes: row.size_bytes,
      modifiedAtMs: row.modified_at_ms,
      rotationDegrees: row.rotation_degrees
    })
  }
```

- [ ] **Step 2: Update drag validation in `libraryIpc.ts`**

Import the service:

```ts
import { resolveRotatedExportPath } from './rotatedExport'
```

Replace `validateClipFile(store, clipId)` with a new function:

```ts
async function resolveDragFile(
  runtime: LibraryRuntime,
  clipId: string
): Promise<ClipdockResult<string>> {
  const asset = runtime.store.getClipDragAsset(clipId)
  if (!asset.ok) return fromLibraryResult(asset)

  const extension = getSupportedExtension(asset.value.filePath)
  if (!extension) {
    return fail('UNSUPPORTED_EXTENSION', 'ClipDock can drag supported video files only.', {
      phase: 'drag',
      sourcePath: asset.value.filePath
    })
  }

  try {
    const stats = await stat(asset.value.filePath)
    if (!stats.isFile()) {
      return fail('NOT_A_FILE', 'The selected clip path is not a file.', {
        phase: 'drag',
        sourcePath: asset.value.filePath
      })
    }
  } catch {
    return fail('MISSING_FILE', 'The selected clip file is no longer available.', {
      phase: 'drag',
      sourcePath: asset.value.filePath
    })
  }

  const exportResult = await resolveRotatedExportPath({
    store: runtime.store,
    clipId: asset.value.id,
    sourcePath: asset.value.filePath,
    sourceSizeBytes: asset.value.sizeBytes,
    sourceModifiedAtMs: asset.value.modifiedAtMs,
    rotationDegrees: asset.value.rotationDegrees,
    exportCacheDir: runtime.storage.exportCacheDir
  })

  return fromLibraryResult(exportResult)
}
```

In `startClipDrag`, change the validation call to:

```ts
    const validation = await resolveDragFile(runtimeResult.value, clipId)
```

Keep reveal/copy path using original `validateClipFile` so `Reveal in Explorer` still opens the source file.

- [ ] **Step 3: Add contract assertion**

In the main process ownership test, add:

```js
  assert.match(ipc, /resolveRotatedExportPath/)
  assert.match(ipc, /exportCacheDir/)
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm run test:mvp
npm run typecheck:node
```

Expected: PASS for node-side tests and typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/main/libraryStore.ts src/main/libraryIpc.ts test/mvp-contract.test.mjs
git commit -m "feat: drag rotated export variants"
```

---

### Task 9: Refactor Renderer State Into Hooks And Components

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/hooks/useLibrary.ts`
- Create: `src/renderer/src/hooks/useClipSelection.ts`
- Create: `src/renderer/src/components/ClipGrid.tsx`
- Create: `src/renderer/src/components/PreviewStage.tsx`
- Create: `src/renderer/src/components/Sidebar.tsx`
- Test: `test/mvp-contract.test.mjs`

- [ ] **Step 1: Add renderer contract assertions**

In `test('renderer implements the main visual workflow without direct Node access', ...)`, add:

```js
  for (const surface of [
    'PreviewStage',
    'ContextMenu',
    'rotationDegrees',
    'Bins',
    'Add Bin',
    'Remove from ClipDock',
    'onDrop'
  ]) {
    assert.match(app, new RegExp(surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
```

Also read created component files at the top of the test after implementation:

```js
const previewStage = read('src/renderer/src/components/PreviewStage.tsx')
const sidebarComponent = read('src/renderer/src/components/Sidebar.tsx')
const clipGridComponent = read('src/renderer/src/components/ClipGrid.tsx')
```

Add assertions:

```js
  assert.match(previewStage, /preview-video/)
  assert.match(sidebarComponent, /bins/)
  assert.match(clipGridComponent, /onContextMenu/)
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run test:mvp
```

Expected: FAIL because component files and renderer surfaces do not exist yet.

- [ ] **Step 3: Create `useClipSelection`**

Create `src/renderer/src/hooks/useClipSelection.ts`:

```ts
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction
} from 'react'
import type { LibraryClipRecordSummary } from '../../../shared/clipdock'

export function useClipSelection(clips: LibraryClipRecordSummary[]): {
  activeClip: LibraryClipRecordSummary | null
  activeClipId: string | null
  selectedClipIds: Set<string>
  selectedClipIdsRef: MutableRefObject<Set<string>>
  setActiveClipId: (clipId: string | null) => void
  setSelectedClipIds: Dispatch<SetStateAction<Set<string>>>
  selectClip: (clip: LibraryClipRecordSummary, event: MouseEvent) => void
  openClip: (clip: LibraryClipRecordSummary) => void
} {
  const [activeClipId, setActiveClipId] = useState<string | null>(null)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const selectedClipIdsRef = useRef(selectedClipIds)
  const activeClipIdRef = useRef(activeClipId)

  useEffect(() => {
    selectedClipIdsRef.current = selectedClipIds
  }, [selectedClipIds])

  useEffect(() => {
    activeClipIdRef.current = activeClipId
  }, [activeClipId])

  useEffect(() => {
    setSelectedClipIds(
      (current) => new Set([...current].filter((clipId) => clips.some((clip) => clip.id === clipId)))
    )
    if (!activeClipIdRef.current || !clips.some((clip) => clip.id === activeClipIdRef.current)) {
      setActiveClipId(clips[0]?.id ?? null)
    }
  }, [clips])

  const selectClip = useCallback((clip: LibraryClipRecordSummary, event: MouseEvent): void => {
    setActiveClipId(clip.id)
    setSelectedClipIds((current) => {
      const multi = event.metaKey || event.ctrlKey
      const next = new Set(multi ? current : [])
      if (multi && next.has(clip.id)) next.delete(clip.id)
      else next.add(clip.id)
      return next
    })
  }, [])

  const openClip = useCallback((clip: LibraryClipRecordSummary): void => {
    setActiveClipId(clip.id)
    setSelectedClipIds(new Set([clip.id]))
  }, [])

  return {
    activeClip: clips.find((clip) => clip.id === activeClipId) ?? clips[0] ?? null,
    activeClipId,
    selectedClipIds,
    selectedClipIdsRef,
    setActiveClipId,
    setSelectedClipIds,
    selectClip,
    openClip
  }
}
```

- [ ] **Step 4: Create component shells**

Move existing `Sidebar`, `ClipGrid`, `ClipCard`, and preview details behavior out of `App.tsx` into the new component files. Preserve existing props first; bin and rotation behavior is added in later tasks.

For `PreviewStage.tsx`, start with:

```tsx
import type { JSX } from 'react'
import type { LibraryClipRecordSummary } from '../../../shared/clipdock'

export function PreviewStage({
  clip,
  onToggleFavorite,
  onReveal,
  onCopyPath
}: {
  clip: LibraryClipRecordSummary | null
  onToggleFavorite: (clip: LibraryClipRecordSummary) => void
  onReveal: (clip: LibraryClipRecordSummary) => void
  onCopyPath: (clip: LibraryClipRecordSummary) => void
}): JSX.Element {
  if (!clip) {
    return (
      <section className="preview-stage empty">
        <strong>No clip selected</strong>
      </section>
    )
  }

  return (
    <section className="preview-stage">
      <video
        className={`preview-video rotate-${clip.rotationDegrees}`}
        src={clip.previewUrl}
        controls
        preload="metadata"
      />
      <div className="preview-info">
        <h2>{clip.displayName}</h2>
        <p>{clip.filePath}</p>
        <div className="preview-actions">
          <button type="button" onClick={() => onToggleFavorite(clip)}>
            {clip.favorite ? 'Favorite' : 'Star'}
          </button>
          <button type="button" onClick={() => onReveal(clip)}>
            Reveal in Explorer
          </button>
          <button type="button" onClick={() => onCopyPath(clip)}>
            Copy Path
          </button>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Wire components back into `App.tsx`**

Import the new components and hook:

```ts
import { Sidebar } from './components/Sidebar'
import { ClipGrid } from './components/ClipGrid'
import { PreviewStage } from './components/PreviewStage'
import { useClipSelection } from './hooks/useClipSelection'
```

Replace local selection state with `useClipSelection(filteredClips)`.

- [ ] **Step 6: Run web typecheck**

Run:

```bash
npm run typecheck:web
```

Expected: PASS after resolving prop imports and relative paths.

- [ ] **Step 7: Commit renderer split**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components src/renderer/src/hooks test/mvp-contract.test.mjs
git commit -m "refactor: split renderer library workflow"
```

---

### Task 10: Implement Preview-First Layout And Rotation Controls

**Files:**
- Modify: `src/renderer/src/components/PreviewStage.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/assets/main.css`

- [ ] **Step 1: Add rotation props to `PreviewStage`**

Change the props:

```tsx
  onRotate: (clip: LibraryClipRecordSummary, rotationDegrees: 0 | 90 | 180 | 270) => void
```

Add rotation controls:

```tsx
        <div className="rotation-controls" aria-label="Video rotation">
          {[0, 90, 180, 270].map((degrees) => (
            <button
              type="button"
              key={degrees}
              className={clip.rotationDegrees === degrees ? 'active' : ''}
              onClick={() => onRotate(clip, degrees as 0 | 90 | 180 | 270)}
            >
              {degrees}°
            </button>
          ))}
        </div>
```

- [ ] **Step 2: Add update handler in `App.tsx`**

Add:

```ts
  const handleUpdateRotation = useCallback(
    async (clip: LibraryClipRecordSummary, rotationDegrees: 0 | 90 | 180 | 270): Promise<void> => {
      const api = getClipdockApi()
      if (!api) return
      await runSnapshotAction(
        () => api.updateClipRotation(clip.id, rotationDegrees),
        'Saving rotation...'
      )
    },
    [runSnapshotAction]
  )
```

Pass `onRotate={handleUpdateRotation}` to `PreviewStage`.

- [ ] **Step 3: Replace the three-column shell CSS**

In `src/renderer/src/assets/main.css`, change `.app-shell` to:

```css
.app-shell {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  height: 100vh;
  color: var(--clipdock-ink);
  background: linear-gradient(180deg, rgba(34, 43, 55, 0.74), rgba(11, 13, 16, 0.96)), #0b0d10;
}
```

Change `.library-view` rows:

```css
.library-view {
  display: grid;
  grid-template-rows: auto minmax(320px, 48vh) auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
}
```

Add preview-first styles:

```css
.preview-stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 320px);
  gap: 14px;
  min-height: 0;
  padding: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(5, 7, 10, 0.62);
}

.preview-stage.empty {
  place-content: center;
  color: rgba(226, 232, 240, 0.72);
}

.preview-stage .preview-video {
  width: 100%;
  height: 100%;
  min-height: 280px;
  aspect-ratio: 16 / 9;
  object-fit: contain;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: #05070a;
}

.preview-video.rotate-90 {
  transform: rotate(90deg);
}

.preview-video.rotate-180 {
  transform: rotate(180deg);
}

.preview-video.rotate-270 {
  transform: rotate(270deg);
}

.preview-info {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}

.preview-info h2,
.preview-info p {
  margin: 0;
  overflow-wrap: anywhere;
}

.preview-actions,
.rotation-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rotation-controls button.active {
  border-color: rgba(125, 211, 252, 0.62);
  background: rgba(125, 211, 252, 0.16);
}
```

Remove or stop rendering the old `.details-panel` as a primary layout column.

- [ ] **Step 4: Run web typecheck and lint**

Run:

```bash
npm run typecheck:web
npm run lint
```

Expected: PASS after formatting.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/PreviewStage.tsx src/renderer/src/assets/main.css
git commit -m "feat: add preview first rotation controls"
```

---

### Task 11: Implement Bins UI, Drop Targets, And Context Menus

**Files:**
- Create: `src/renderer/src/components/ContextMenu.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/ClipGrid.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/assets/main.css`

- [ ] **Step 1: Create `ContextMenu.tsx`**

```tsx
import type { JSX } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  destructive?: boolean
  disabled?: boolean
  onSelect: () => void
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}): JSX.Element {
  return (
    <div className="context-menu-backdrop" onClick={onClose}>
      <div
        className="context-menu"
        style={{ left: x, top: y }}
        onClick={(event) => event.stopPropagation()}
      >
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.destructive ? 'destructive' : ''}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add bin props to `Sidebar`**

`Sidebar` receives:

```ts
  bins: LibraryBinRecordSummary[]
  activeBinId: string | null
  onSelectBin: (binId: string | null) => void
  onCreateBin: () => void
  onRenameBin: (binId: string) => void
  onDeleteBin: (binId: string) => void
  onDropClipsToBin: (clipIds: string[], binId: string) => void
  onOpenBinMenu: (binId: string, x: number, y: number) => void
```

Add this helper inside `Sidebar.tsx`:

```ts
function parseClipIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}
```

Render bins:

```tsx
      <section className="sidebar-section bins">
        <div className="section-heading-row">
          <h2>Bins</h2>
          <button type="button" onClick={onCreateBin} disabled={busy}>
            Add Bin
          </button>
        </div>
        {bins.length === 0 ? <span className="muted">No bins</span> : null}
        {bins.map((bin) => (
          <button
            type="button"
            key={bin.id}
            className={activeBinId === bin.id ? 'bin-row active' : 'bin-row'}
            onClick={() => onSelectBin(bin.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              const ids = event.dataTransfer.getData('application/x-clipdock-clip-ids')
              onDropClipsToBin(parseClipIds(ids), bin.id)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              onOpenBinMenu(bin.id, event.clientX, event.clientY)
            }}
          >
            <strong>{bin.name}</strong>
            <span>{bin.clipCount}</span>
          </button>
        ))}
      </section>
```

- [ ] **Step 3: Add drag data to `ClipGrid`**

In clip drag start handler before native drag starts:

```ts
event.dataTransfer.setData('application/x-clipdock-clip-ids', JSON.stringify(selectedIds))
```

Keep calling `api.startClipDrag({ clipIds: selectedIds })` so external editor drag still works.

- [ ] **Step 4: Add app handlers**

In `App.tsx`, add:

```ts
  const [activeBinId, setActiveBinId] = useState<string | null>(null)
```

Filter clips by active bin:

```ts
      if (activeBinId && !clip.binIds.includes(activeBinId)) return false
```

Add handlers:

```ts
  const handleCreateBin = useCallback(async (): Promise<void> => {
    const name = window.prompt('Bin name')
    const api = getClipdockApi()
    if (!api || !name) return
    await runSnapshotAction(() => api.createBin(name), 'Creating bin...')
  }, [runSnapshotAction])

  const handleRenameBin = useCallback(
    async (binId: string): Promise<void> => {
      const current = snapshot?.bins.find((bin) => bin.id === binId)
      const name = window.prompt('Bin name', current?.name ?? '')
      const api = getClipdockApi()
      if (!api || !name) return
      await runSnapshotAction(() => api.renameBin(binId, name), 'Renaming bin...')
    },
    [runSnapshotAction, snapshot]
  )

  const handleDeleteBin = useCallback(
    async (binId: string): Promise<void> => {
      const api = getClipdockApi()
      if (!api) return
      await runSnapshotAction(() => api.deleteBin(binId), 'Deleting bin...')
      if (activeBinId === binId) setActiveBinId(null)
    },
    [activeBinId, runSnapshotAction]
  )

  const handleDropClipsToBin = useCallback(
    async (clipIds: string[], binId: string): Promise<void> => {
      const api = getClipdockApi()
      if (!api || clipIds.length === 0) return
      await runSnapshotAction(() => api.addClipsToBin(clipIds, binId), 'Adding clips to bin...')
    },
    [runSnapshotAction]
  )
```

Use the `ContextMenu` component for clip and bin right-click actions. Clip actions call `api.removeClipsFromBin`, `api.removeClipsFromLibrary`, `api.addClipsToBin`, or `api.moveClipsToBin` depending on active bin state.

- [ ] **Step 5: Add context and bin styles**

Add:

```css
.section-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.bin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 0.48rem 0.62rem;
  text-align: left;
}

.bin-row.active {
  border-color: rgba(125, 211, 252, 0.62);
  background: rgba(125, 211, 252, 0.16);
}

.context-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
}

.context-menu {
  position: fixed;
  display: grid;
  min-width: 190px;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: #111827;
  box-shadow: var(--clipdock-shadow);
}

.context-menu button {
  min-height: 32px;
  padding: 0.42rem 0.55rem;
  text-align: left;
}

.context-menu button.destructive {
  color: #fecdd3;
}
```

- [ ] **Step 6: Run web checks**

Run:

```bash
npm run typecheck:web
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components src/renderer/src/assets/main.css
git commit -m "feat: add bins ui and context actions"
```

---

### Task 12: Final Verification And Documentation

**Files:**
- Modify: `README.md`
- Verify: full project

- [ ] **Step 1: Update README workflow**

In `README.md`, add bullets under Daily Workflow:

```md
- Create ClipDock bins to organize clips without moving source files.
- Drag clips onto bins or use right-click actions to add, move, or remove them.
- Rotate clips in 90-degree increments from the preview stage.
- Dragging a rotated clip exports a non-destructive rotated copy and drags that file.
```

Add a Local Data bullet:

```md
- Rotated exports: Electron `userData/clipdock-library/exports`
```

Add a safety sentence:

```md
Removing a clip or bin from ClipDock does not delete source media from disk.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run test:mvp
npm run typecheck
npm run lint
npm run build
```

Expected: all commands PASS.

- [ ] **Step 3: Start the app for manual smoke test**

Run:

```bash
npm run dev
```

Manual checks:

- Add or copy a video.
- Create two bins.
- Drag one clip into both bins.
- Filter each bin and confirm the clip appears.
- Right-click the clip and remove it from the active bin.
- Rotate the clip to 90 degrees and confirm preview changes.
- Drag the rotated clip to a file-drop target and confirm a generated `.mp4` from the exports directory is used.
- Remove the clip from ClipDock and confirm the source file still exists.

- [ ] **Step 4: Commit final docs and verification fixes**

```bash
git add README.md test/mvp-contract.test.mjs src
git commit -m "docs: document bins and rotation workflow"
```

- [ ] **Step 5: Report final status**

Include:

- Latest commit hash.
- Verification command results.
- Any manual smoke-test limitations, especially if DaVinci Resolve was not available on the machine.
