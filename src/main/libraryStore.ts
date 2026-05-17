import { randomUUID } from 'node:crypto'
import { mkdirSync, statSync, type Stats } from 'node:fs'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  SUPPORTED_VIDEO_EXTENSIONS,
  type ClipImportMode,
  type ClipRotationDegrees,
  type ClipdockErrorCode,
  type CopiedClipImportResult,
  type LibraryBinRecordSummary,
  type LibraryClipExportRecordSummary,
  type LibraryClipRecordSummary,
  type LibraryClipStatus,
  type LibraryFailure,
  type LibraryImportPhase,
  type LibraryImportSummary,
  type LibraryResult,
  type LibrarySnapshot,
  type LibrarySourceKind,
  type LibrarySourceRecordSummary,
  type LibrarySourceStatus,
  type LinkedFolderImportResult,
  type SupportedVideoExtension
} from '../shared/clipdock'

const SCHEMA_VERSION = 3
const SQLITE_TRUE = 1
const SQLITE_FALSE = 0
const LINKED_FOLDER_MODE: ClipImportMode = 'linked-folder'
const COPIED_FILE_MODE: ClipImportMode = 'copied-file'
const FOLDER_SOURCE_KIND: LibrarySourceKind = 'folder'
const MANAGED_FILE_SOURCE_KIND: LibrarySourceKind = 'managed-file'

export interface LibraryStoreOptions {
  databaseFile: string
  libraryDir: string
  now?: () => number
  createId?: () => string
}

export interface CreateLinkedFolderRecordInput {
  folder: string
}

export interface CreateCopiedClipRecordInput {
  sourceFile: string
  managedFile: string
}

export interface ScannableSource {
  id: string
  kind: LibrarySourceKind
  importMode: ClipImportMode
  displayName: string
  sourcePath: string
  targetPath: string | null
}

export interface ClipFreshnessInput {
  filePath: string
  sizeBytes: number
  modifiedAtMs: number
}

export interface ScannedClipInput {
  sourceId: string
  importMode: ClipImportMode
  sourcePath: string
  targetPath: string | null
  sizeBytes: number
  modifiedAtMs: number
  fileCreatedAtMs: number | null
  durationMs: number | null
  widthPixels: number | null
  heightPixels: number | null
  fps: number | null
  codec: string | null
  metadataJson: string | null
  thumbnailPath: string | null
  thumbnailGeneratedAtMs: number | null
  status: LibraryClipStatus
  lastErrorCode: ClipdockErrorCode | null
  lastErrorMessage: string | null
}

export interface UpsertScannedClipResult {
  clip: LibraryClipRecordSummary
  created: boolean
  updated: boolean
}

export interface ClipDragAsset {
  id: string
  filePath: string
  sizeBytes: number
  modifiedAtMs: number
  rotationDegrees: ClipRotationDegrees
}

export interface ClipExportInput {
  clipId: string
  rotationDegrees: Exclude<ClipRotationDegrees, 0>
  sourceSizeBytes: number
  sourceModifiedAtMs: number
}

export interface UpsertClipExportInput extends ClipExportInput {
  exportPath: string
}

export interface LibraryStore {
  snapshot: () => LibraryResult<LibrarySnapshot>
  createLinkedFolderRecord: (
    input: CreateLinkedFolderRecordInput
  ) => LibraryResult<LinkedFolderImportResult>
  createCopiedClipRecord: (
    input: CreateCopiedClipRecordInput
  ) => LibraryResult<CopiedClipImportResult>
  listScannableSources: () => LibraryResult<ScannableSource[]>
  markSourceScanStarted: (sourceId: string) => LibraryResult<void>
  markSourceScanCompleted: (sourceId: string) => LibraryResult<void>
  markSourceScanError: (
    sourceId: string,
    code: ClipdockErrorCode,
    message: string
  ) => LibraryResult<void>
  isClipUpToDate: (input: ClipFreshnessInput) => LibraryResult<boolean>
  upsertScannedClip: (input: ScannedClipInput) => LibraryResult<UpsertScannedClipResult>
  toggleFavorite: (clipId: string) => LibraryResult<LibrarySnapshot>
  updateClipTags: (clipId: string, tags: string[]) => LibraryResult<LibrarySnapshot>
  updateClipNote: (clipId: string, note: string) => LibraryResult<LibrarySnapshot>
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
  removeClipsFromLibrary: (clipIds: string[]) => LibraryResult<LibrarySnapshot>
  updateClipRotation: (
    clipId: string,
    rotationDegrees: ClipRotationDegrees
  ) => LibraryResult<LibrarySnapshot>
  getClipRotationExport: (
    input: ClipExportInput
  ) => LibraryResult<LibraryClipExportRecordSummary | null>
  upsertClipRotationExport: (
    input: UpsertClipExportInput
  ) => LibraryResult<LibraryClipExportRecordSummary>
  getClipDragAsset: (clipId: string) => LibraryResult<ClipDragAsset>
  getClipAsset: (clipId: string, kind: 'media' | 'thumbnail') => LibraryResult<string>
  close: () => LibraryResult<void>
}

interface SourceRow {
  id: string
  kind: LibrarySourceKind
  import_mode: ClipImportMode
  status: LibrarySourceStatus
  display_name: string
  source_path: string
  target_path: string | null
  normalized_source_path: string
  normalized_target_path: string | null
  created_at_ms: number
  updated_at_ms: number
  last_scanned_at_ms: number | null
  last_scan_started_at_ms: number | null
  last_scan_completed_at_ms: number | null
  last_error_code: ClipdockErrorCode | null
  last_error_message: string | null
  clip_count: number
}

interface ClipRow {
  id: string
  source_id: string
  import_mode: ClipImportMode
  status: LibraryClipStatus
  display_name: string
  extension: SupportedVideoExtension
  source_path: string
  target_path: string | null
  normalized_source_path: string
  normalized_target_path: string | null
  size_bytes: number
  modified_at_ms: number
  file_created_at_ms: number | null
  duration_ms: number | null
  width_pixels: number | null
  height_pixels: number | null
  fps: number | null
  codec: string | null
  metadata_json: string | null
  thumbnail_path: string | null
  thumbnail_generated_at_ms: number | null
  favorite: number
  note: string
  rotation_degrees: ClipRotationDegrees
  created_at_ms: number
  updated_at_ms: number
  last_error_code: ClipdockErrorCode | null
  last_error_message: string | null
}

interface TagRow {
  id: string
  name: string
  normalized_name: string
}

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

interface NormalizedLocation {
  absolute: string
  normalized: string
}

function ok<T>(value: T): LibraryResult<T> {
  return { ok: true, value }
}

function fail<T>(
  code: ClipdockErrorCode,
  phase: LibraryImportPhase,
  message: string,
  details: { sourcePath?: string; targetPath?: string } = {}
): LibraryResult<T> {
  const error: LibraryFailure = {
    code,
    phase,
    message,
    ...(details.sourcePath ? { sourcePath: details.sourcePath } : {}),
    ...(details.targetPath ? { targetPath: details.targetPath } : {})
  }

  return { ok: false, error }
}

function nowMs(now: () => number): number {
  return Math.round(now())
}

function normalizeForUnique(absoluteLocation: string): string {
  return process.platform === 'win32'
    ? absoluteLocation.toLocaleLowerCase('en-US')
    : absoluteLocation
}

function normalizeInputLocation(
  input: string,
  phase: LibraryImportPhase
): LibraryResult<NormalizedLocation> {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return fail(
      'LIBRARY_INVALID_INPUT',
      phase,
      'A non-empty local file system location is required.'
    )
  }

  const absolute = resolve(input)

  return ok({ absolute, normalized: normalizeForUnique(absolute) })
}

function isInsideDirectory(child: string, parent: string): boolean {
  const offset = relative(resolve(parent), resolve(child))

  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset))
}

function getSupportedExtension(fileLocation: string): SupportedVideoExtension | null {
  const extension = extname(fileLocation).toLowerCase()

  if (SUPPORTED_VIDEO_EXTENSIONS.includes(extension as SupportedVideoExtension)) {
    return extension as SupportedVideoExtension
  }

  return null
}

function inspectLocation(
  absolute: string,
  phase: LibraryImportPhase,
  details: { sourcePath?: string; targetPath?: string }
): LibraryResult<Stats> {
  try {
    return ok(statSync(absolute))
  } catch {
    return fail(
      'LIBRARY_STAT_FAILED',
      phase,
      'The local file system location could not be inspected.',
      details
    )
  }
}

function makeSummary(
  mode: ClipImportMode,
  status: LibraryImportSummary['status'],
  counts: {
    createdSourceCount?: number
    createdClipCount?: number
    duplicateSourceCount?: number
    duplicateClipCount?: number
    skippedCount?: number
    failedCount?: number
  } = {},
  errors: LibraryFailure[] = []
): LibraryImportSummary {
  return {
    mode,
    status,
    createdSourceCount: counts.createdSourceCount ?? 0,
    createdClipCount: counts.createdClipCount ?? 0,
    duplicateSourceCount: counts.duplicateSourceCount ?? 0,
    duplicateClipCount: counts.duplicateClipCount ?? 0,
    skippedCount: counts.skippedCount ?? 0,
    failedCount: counts.failedCount ?? errors.length,
    errors
  }
}

function sourceSummaryFromRow(row: SourceRow): LibrarySourceRecordSummary {
  return {
    id: row.id,
    kind: row.kind,
    importMode: row.import_mode,
    status: row.status,
    displayName: row.display_name,
    displayLocation: row.target_path ?? row.source_path,
    clipCount: row.clip_count,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    lastScannedAtMs: row.last_scanned_at_ms,
    lastScanStartedAtMs: row.last_scan_started_at_ms,
    lastScanCompletedAtMs: row.last_scan_completed_at_ms,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message
  }
}

function mediaUrl(kind: 'clip' | 'thumbnail', clipId: string, updatedAtMs: number): string {
  return `clipdock-media://${kind}/${encodeURIComponent(clipId)}?v=${updatedAtMs}`
}

function actualClipPath(row: ClipRow): string {
  return row.target_path ?? row.source_path
}

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

function clipSummaryFromRow(
  row: ClipRow,
  tags: string[],
  binIds: string[] = []
): LibraryClipRecordSummary {
  const filePath = actualClipPath(row)

  return {
    id: row.id,
    sourceId: row.source_id,
    importMode: row.import_mode,
    status: row.status,
    displayName: row.display_name,
    extension: row.extension,
    filePath,
    folderPath: dirname(filePath),
    sizeBytes: row.size_bytes,
    modifiedAtMs: row.modified_at_ms,
    fileCreatedAtMs: row.file_created_at_ms,
    durationMs: row.duration_ms,
    widthPixels: row.width_pixels,
    heightPixels: row.height_pixels,
    fps: row.fps,
    codec: row.codec,
    metadataJson: row.metadata_json,
    thumbnailUrl: row.thumbnail_path ? mediaUrl('thumbnail', row.id, row.updated_at_ms) : null,
    previewUrl: mediaUrl('clip', row.id, row.updated_at_ms),
    favorite: row.favorite === SQLITE_TRUE,
    note: row.note,
    tags,
    binIds,
    rotationDegrees: row.rotation_degrees,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message
  }
}

function safeRollback(database: DatabaseSync): void {
  try {
    database.exec('ROLLBACK')
  } catch {
    // Ignore rollback failures when no transaction is open.
  }
}

function normalizeTagName(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ')
}

function normalizeTagKey(tag: string): string {
  return normalizeTagName(tag).toLocaleLowerCase('en-US')
}

function boundedNote(note: string): string {
  return note.slice(0, 4000)
}

function normalizeBinKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function boundedBinName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 80)
}

function validClipIds(value: string[]): string[] {
  return [...new Set(value.map((id) => id.trim()).filter(Boolean))].slice(0, 256)
}

function isClipRotationDegrees(value: unknown): value is ClipRotationDegrees {
  return value === 0 || value === 90 || value === 180 || value === 270
}

function ensureColumn(
  database: DatabaseSync,
  tableName: string,
  columnName: string,
  ddl: string
): void {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string
  }>

  if (!columns.some((column) => column.name === columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`)
  }
}

class SqliteLibraryStore implements LibraryStore {
  private readonly database: DatabaseSync
  private readonly libraryRoot: NormalizedLocation
  private readonly now: () => number
  private readonly createId: () => string
  private closed = false

  constructor(
    database: DatabaseSync,
    libraryRoot: NormalizedLocation,
    now: () => number,
    createId: () => string
  ) {
    this.database = database
    this.libraryRoot = libraryRoot
    this.now = now
    this.createId = createId
  }

  migrate(): LibraryResult<void> {
    if (this.closed) {
      return fail('LIBRARY_CLOSED', 'migrate', 'The ClipDock library database is already closed.')
    }

    const appliedAtMs = nowMs(this.now)

    try {
      this.database.exec('PRAGMA foreign_keys = ON')
      this.database.exec('PRAGMA journal_mode = WAL')
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS library_schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS library_sources (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('folder', 'managed-file')),
          import_mode TEXT NOT NULL CHECK (import_mode IN ('linked-folder', 'copied-file')),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'missing', 'error', 'removed')),
          display_name TEXT NOT NULL,
          source_path TEXT NOT NULL,
          target_path TEXT,
          normalized_source_path TEXT NOT NULL,
          normalized_target_path TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          last_scanned_at_ms INTEGER,
          last_scan_started_at_ms INTEGER,
          last_scan_completed_at_ms INTEGER,
          last_error_code TEXT,
          last_error_message TEXT,
          UNIQUE (kind, normalized_source_path),
          UNIQUE (kind, normalized_target_path)
        );

        CREATE TABLE IF NOT EXISTS clips (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES library_sources(id) ON DELETE CASCADE,
          import_mode TEXT NOT NULL CHECK (import_mode IN ('linked-folder', 'copied-file')),
          status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'missing', 'error', 'removed')),
          display_name TEXT NOT NULL,
          extension TEXT NOT NULL,
          source_path TEXT NOT NULL,
          target_path TEXT,
          normalized_source_path TEXT NOT NULL,
          normalized_target_path TEXT,
          size_bytes INTEGER NOT NULL,
          modified_at_ms INTEGER NOT NULL,
          file_created_at_ms INTEGER,
          duration_ms INTEGER,
          width_pixels INTEGER,
          height_pixels INTEGER,
          fps REAL,
          codec TEXT,
          metadata_json TEXT,
          thumbnail_path TEXT,
          thumbnail_generated_at_ms INTEGER,
          favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
          note TEXT NOT NULL DEFAULT '',
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          last_error_code TEXT,
          last_error_message TEXT,
          UNIQUE (import_mode, normalized_source_path),
          UNIQUE (import_mode, normalized_target_path)
        );

        CREATE TABLE IF NOT EXISTS clip_marks (
          id TEXT PRIMARY KEY,
          clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
          label TEXT NOT NULL DEFAULT '',
          start_ms INTEGER NOT NULL DEFAULT 0,
          end_ms INTEGER,
          note TEXT NOT NULL DEFAULT '',
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL UNIQUE,
          color TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS clip_tags (
          clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          created_at_ms INTEGER NOT NULL,
          PRIMARY KEY (clip_id, tag_id)
        );

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

        CREATE INDEX IF NOT EXISTS idx_library_sources_kind_status
          ON library_sources(kind, status);
        CREATE INDEX IF NOT EXISTS idx_library_sources_import_mode
          ON library_sources(import_mode);
        CREATE INDEX IF NOT EXISTS idx_library_sources_scan_bookkeeping
          ON library_sources(last_scan_started_at_ms, last_scan_completed_at_ms, last_scanned_at_ms);
        CREATE INDEX IF NOT EXISTS idx_clips_source_id
          ON clips(source_id);
        CREATE INDEX IF NOT EXISTS idx_clips_status_import_mode
          ON clips(status, import_mode);
        CREATE INDEX IF NOT EXISTS idx_clips_modified_at_ms
          ON clips(modified_at_ms);
        CREATE INDEX IF NOT EXISTS idx_clips_display_name
          ON clips(display_name);
        CREATE INDEX IF NOT EXISTS idx_clips_favorite
          ON clips(favorite);
        CREATE INDEX IF NOT EXISTS idx_clip_marks_clip_id
          ON clip_marks(clip_id);
        CREATE INDEX IF NOT EXISTS idx_tags_name
          ON tags(normalized_name);
        CREATE INDEX IF NOT EXISTS idx_clip_tags_clip_id
          ON clip_tags(clip_id);
        CREATE INDEX IF NOT EXISTS idx_clip_tags_tag_id
          ON clip_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_bins_sort_order
          ON bins(sort_order, name);
        CREATE INDEX IF NOT EXISTS idx_clip_bins_clip_id
          ON clip_bins(clip_id);
        CREATE INDEX IF NOT EXISTS idx_clip_bins_bin_id
          ON clip_bins(bin_id);
        CREATE INDEX IF NOT EXISTS idx_clip_exports_clip_variant
          ON clip_exports(clip_id, variant_kind, rotation_degrees);
      `)

      ensureColumn(this.database, 'clips', 'file_created_at_ms', 'file_created_at_ms INTEGER')
      ensureColumn(this.database, 'clips', 'fps', 'fps REAL')
      ensureColumn(this.database, 'clips', 'codec', 'codec TEXT')
      ensureColumn(
        this.database,
        'clips',
        'rotation_degrees',
        'rotation_degrees INTEGER NOT NULL DEFAULT 0 CHECK (rotation_degrees IN (0, 90, 180, 270))'
      )

      try {
        this.database.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS clip_search
          USING fts5(clip_id UNINDEXED, filename, path, tags, note);
        `)
      } catch {
        // FTS5 is optional; renderer search still works from the SQLite snapshot.
      }

      this.database
        .prepare(
          `INSERT OR REPLACE INTO library_schema_migrations (version, applied_at_ms)
           VALUES (?, ?)`
        )
        .run(SCHEMA_VERSION, appliedAtMs)
      this.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    } catch {
      safeRollback(this.database)
      return fail(
        'LIBRARY_MIGRATION_FAILED',
        'migrate',
        'The ClipDock library database could not be initialized.'
      )
    }

    return ok(undefined)
  }

  snapshot(): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('snapshot')

    if (!openResult.ok) {
      return openResult
    }

    try {
      const sourceRows = this.database
        .prepare(
          `SELECT s.*, COUNT(c.id) AS clip_count
             FROM library_sources s
             LEFT JOIN clips c ON c.source_id = s.id AND c.status != 'removed'
            GROUP BY s.id
            ORDER BY s.created_at_ms ASC, s.id ASC`
        )
        .all() as unknown as SourceRow[]
      const clipRows = this.database
        .prepare(
          "SELECT * FROM clips WHERE status != 'removed' ORDER BY display_name COLLATE NOCASE ASC, id ASC"
        )
        .all() as unknown as ClipRow[]
      const tagsByClipId = this.readTagsByClipId()
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
    } catch {
      return fail(
        'LIBRARY_SNAPSHOT_FAILED',
        'snapshot',
        'The ClipDock library snapshot could not be read.'
      )
    }
  }

  createLinkedFolderRecord(
    input: CreateLinkedFolderRecordInput
  ): LibraryResult<LinkedFolderImportResult> {
    const openResult = this.requireOpen('validate-source')

    if (!openResult.ok) {
      return openResult
    }

    const folderResult = normalizeInputLocation(input.folder, 'validate-source')

    if (!folderResult.ok) {
      return folderResult
    }

    const statResult = inspectLocation(folderResult.value.absolute, 'stat-source', {
      sourcePath: folderResult.value.absolute
    })

    if (!statResult.ok) {
      return statResult
    }

    if (!statResult.value.isDirectory()) {
      return fail(
        'LIBRARY_NOT_A_DIRECTORY',
        'stat-source',
        'The selected source is not a folder.',
        {
          sourcePath: folderResult.value.absolute
        }
      )
    }

    const existing = this.readSourceByNormalized(FOLDER_SOURCE_KIND, folderResult.value.normalized)

    if (existing) {
      return ok({
        source: sourceSummaryFromRow(existing),
        summary: makeSummary(LINKED_FOLDER_MODE, 'duplicate', {
          duplicateSourceCount: 1,
          skippedCount: 1
        })
      })
    }

    try {
      this.database.exec('BEGIN IMMEDIATE')

      const timestamp = nowMs(this.now)
      const sourceId = this.createId()

      this.database
        .prepare(
          `INSERT INTO library_sources (
             id, kind, import_mode, status, display_name, source_path, target_path,
             normalized_source_path, normalized_target_path, created_at_ms, updated_at_ms,
             last_scanned_at_ms, last_scan_started_at_ms, last_scan_completed_at_ms,
             last_error_code, last_error_message
           ) VALUES (?, ?, ?, 'active', ?, ?, NULL, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL)`
        )
        .run(
          sourceId,
          FOLDER_SOURCE_KIND,
          LINKED_FOLDER_MODE,
          basename(folderResult.value.absolute),
          folderResult.value.absolute,
          folderResult.value.normalized,
          timestamp,
          timestamp
        )

      this.database.exec('COMMIT')

      const source = this.readSourceById(sourceId)

      if (!source) {
        return fail(
          'LIBRARY_PERSIST_FAILED',
          'persist',
          'The linked folder record could not be reloaded.',
          {
            sourcePath: folderResult.value.absolute
          }
        )
      }

      return ok({
        source: sourceSummaryFromRow(source),
        summary: makeSummary(LINKED_FOLDER_MODE, 'imported', { createdSourceCount: 1 })
      })
    } catch {
      safeRollback(this.database)
      return fail(
        'LIBRARY_PERSIST_FAILED',
        'persist',
        'The linked folder record could not be saved.',
        {
          sourcePath: folderResult.value.absolute
        }
      )
    }
  }

  createCopiedClipRecord(
    input: CreateCopiedClipRecordInput
  ): LibraryResult<CopiedClipImportResult> {
    const openResult = this.requireOpen('validate-source')

    if (!openResult.ok) {
      return openResult
    }

    const sourceResult = normalizeInputLocation(input.sourceFile, 'validate-source')

    if (!sourceResult.ok) {
      return sourceResult
    }

    const targetResult = normalizeInputLocation(input.managedFile, 'validate-target')

    if (!targetResult.ok) {
      return fail(
        targetResult.error.code,
        targetResult.error.phase ?? 'validate-target',
        targetResult.error.message,
        {
          sourcePath: sourceResult.value.absolute
        }
      )
    }

    const details = {
      sourcePath: sourceResult.value.absolute,
      targetPath: targetResult.value.absolute
    }

    if (!isInsideDirectory(targetResult.value.absolute, this.libraryRoot.absolute)) {
      return fail(
        'LIBRARY_OUTSIDE_MANAGED_STORAGE',
        'validate-target',
        'Managed ClipDock copies must be stored inside the app-owned library directory.',
        details
      )
    }

    const extension = getSupportedExtension(targetResult.value.absolute)

    if (!extension) {
      return fail(
        'LIBRARY_UNSUPPORTED_EXTENSION',
        'validate-target',
        'ClipDock supports video files only.',
        details
      )
    }

    const statResult = inspectLocation(targetResult.value.absolute, 'stat-target', details)

    if (!statResult.ok) {
      return statResult
    }

    if (!statResult.value.isFile()) {
      return fail(
        'LIBRARY_NOT_A_FILE',
        'stat-target',
        'The managed library item is not a file.',
        details
      )
    }

    const existingClip = this.readClipByTarget(targetResult.value.normalized)

    if (existingClip) {
      const source = this.readSourceById(existingClip.source_id)

      if (!source) {
        return fail(
          'LIBRARY_SNAPSHOT_FAILED',
          'snapshot',
          'The duplicate clip source could not be read.',
          details
        )
      }

      return ok({
        source: sourceSummaryFromRow(source),
        clip: clipSummaryFromRow(existingClip, this.readTagsForClip(existingClip.id)),
        summary: makeSummary(COPIED_FILE_MODE, 'duplicate', {
          duplicateSourceCount: 1,
          duplicateClipCount: 1,
          skippedCount: 1
        })
      })
    }

    const existingSource = this.readSourceByNormalized(
      MANAGED_FILE_SOURCE_KIND,
      sourceResult.value.normalized
    )

    if (existingSource) {
      return fail(
        'LIBRARY_DUPLICATE_SOURCE',
        'persist',
        'This copied source is already tracked.',
        details
      )
    }

    try {
      this.database.exec('BEGIN IMMEDIATE')

      const timestamp = nowMs(this.now)
      const sourceId = this.createId()
      const clipId = this.createId()
      const displayName = basename(targetResult.value.absolute)

      this.database
        .prepare(
          `INSERT INTO library_sources (
             id, kind, import_mode, status, display_name, source_path, target_path,
             normalized_source_path, normalized_target_path, created_at_ms, updated_at_ms,
             last_scanned_at_ms, last_scan_started_at_ms, last_scan_completed_at_ms,
             last_error_code, last_error_message
           ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)`
        )
        .run(
          sourceId,
          MANAGED_FILE_SOURCE_KIND,
          COPIED_FILE_MODE,
          displayName,
          sourceResult.value.absolute,
          targetResult.value.absolute,
          sourceResult.value.normalized,
          targetResult.value.normalized,
          timestamp,
          timestamp
        )

      this.database
        .prepare(
          `INSERT INTO clips (
             id, source_id, import_mode, status, display_name, extension, source_path, target_path,
             normalized_source_path, normalized_target_path, size_bytes, modified_at_ms,
             file_created_at_ms, duration_ms, width_pixels, height_pixels, fps, codec,
             metadata_json, thumbnail_path, thumbnail_generated_at_ms, favorite, note,
             created_at_ms, updated_at_ms, last_error_code, last_error_message
           ) VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL,
             NULL, NULL, NULL, 0, '', ?, ?, NULL, NULL)`
        )
        .run(
          clipId,
          sourceId,
          COPIED_FILE_MODE,
          displayName,
          extension,
          sourceResult.value.absolute,
          targetResult.value.absolute,
          sourceResult.value.normalized,
          targetResult.value.normalized,
          statResult.value.size,
          Math.round(statResult.value.mtimeMs),
          Math.round(statResult.value.birthtimeMs),
          timestamp,
          timestamp
        )

      this.database.exec('COMMIT')

      const source = this.readSourceById(sourceId)
      const clip = this.readClipById(clipId)

      if (!source || !clip) {
        return fail(
          'LIBRARY_PERSIST_FAILED',
          'persist',
          'The copied clip record could not be reloaded.',
          details
        )
      }

      return ok({
        source: sourceSummaryFromRow(source),
        clip: clipSummaryFromRow(clip, []),
        summary: makeSummary(COPIED_FILE_MODE, 'imported', {
          createdSourceCount: 1,
          createdClipCount: 1
        })
      })
    } catch {
      safeRollback(this.database)
      return fail(
        'LIBRARY_PERSIST_FAILED',
        'persist',
        'The copied clip record could not be saved.',
        details
      )
    }
  }

  listScannableSources(): LibraryResult<ScannableSource[]> {
    const openResult = this.requireOpen('scan')

    if (!openResult.ok) {
      return openResult
    }

    try {
      const rows = this.database
        .prepare(
          `SELECT id, kind, import_mode, display_name, source_path, target_path
             FROM library_sources
            WHERE status = 'active'
            ORDER BY created_at_ms ASC, id ASC`
        )
        .all() as Array<{
        id: string
        kind: LibrarySourceKind
        import_mode: ClipImportMode
        display_name: string
        source_path: string
        target_path: string | null
      }>

      return ok(
        rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          importMode: row.import_mode,
          displayName: row.display_name,
          sourcePath: row.source_path,
          targetPath: row.target_path
        }))
      )
    } catch {
      return fail(
        'LIBRARY_SNAPSHOT_FAILED',
        'scan',
        'ClipDock could not list library sources for scanning.'
      )
    }
  }

  markSourceScanStarted(sourceId: string): LibraryResult<void> {
    return this.updateSourceScanState(sourceId, {
      last_scan_started_at_ms: nowMs(this.now),
      last_scan_completed_at_ms: null,
      last_error_code: null,
      last_error_message: null,
      updated_at_ms: nowMs(this.now)
    })
  }

  markSourceScanCompleted(sourceId: string): LibraryResult<void> {
    const timestamp = nowMs(this.now)

    return this.updateSourceScanState(sourceId, {
      last_scanned_at_ms: timestamp,
      last_scan_completed_at_ms: timestamp,
      last_error_code: null,
      last_error_message: null,
      updated_at_ms: timestamp
    })
  }

  markSourceScanError(
    sourceId: string,
    code: ClipdockErrorCode,
    message: string
  ): LibraryResult<void> {
    const timestamp = nowMs(this.now)

    return this.updateSourceScanState(sourceId, {
      status: 'error',
      last_scan_completed_at_ms: timestamp,
      last_error_code: code,
      last_error_message: message,
      updated_at_ms: timestamp
    })
  }

  isClipUpToDate(input: ClipFreshnessInput): LibraryResult<boolean> {
    const openResult = this.requireOpen('scan')

    if (!openResult.ok) {
      return openResult
    }

    const normalized = normalizeForUnique(resolve(input.filePath))

    try {
      const row = this.database
        .prepare(
          `SELECT id, size_bytes, modified_at_ms, duration_ms, thumbnail_path, status
             FROM clips
            WHERE normalized_source_path = ? OR normalized_target_path = ?
            LIMIT 1`
        )
        .get(normalized, normalized) as
        | {
            size_bytes: number
            modified_at_ms: number
            duration_ms: number | null
            thumbnail_path: string | null
            status: LibraryClipStatus
          }
        | undefined

      return ok(
        Boolean(
          row &&
          row.status === 'ready' &&
          row.size_bytes === input.sizeBytes &&
          row.modified_at_ms === input.modifiedAtMs &&
          row.duration_ms !== null &&
          row.thumbnail_path
        )
      )
    } catch {
      return fail(
        'LIBRARY_SNAPSHOT_FAILED',
        'scan',
        'ClipDock could not inspect cached clip metadata.',
        {
          sourcePath: input.filePath
        }
      )
    }
  }

  upsertScannedClip(input: ScannedClipInput): LibraryResult<UpsertScannedClipResult> {
    const openResult = this.requireOpen('persist')

    if (!openResult.ok) {
      return openResult
    }

    const sourcePath = resolve(input.sourcePath)
    const targetPath = input.targetPath ? resolve(input.targetPath) : null
    const normalizedSourcePath = normalizeForUnique(sourcePath)
    const normalizedTargetPath = targetPath ? normalizeForUnique(targetPath) : null
    const extension = getSupportedExtension(targetPath ?? sourcePath)

    if (!extension) {
      return fail(
        'LIBRARY_UNSUPPORTED_EXTENSION',
        'persist',
        'ClipDock supports video files only.',
        {
          sourcePath
        }
      )
    }

    try {
      const existing = this.readClipByNormalized(
        input.importMode,
        normalizedSourcePath,
        normalizedTargetPath
      )
      const timestamp = nowMs(this.now)

      this.database.exec('BEGIN IMMEDIATE')

      if (existing) {
        this.database
          .prepare(
            `UPDATE clips
                SET status = ?,
                    display_name = ?,
                    extension = ?,
                    source_path = ?,
                    target_path = ?,
                    normalized_source_path = ?,
                    normalized_target_path = ?,
                    size_bytes = ?,
                    modified_at_ms = ?,
                    file_created_at_ms = ?,
                    duration_ms = ?,
                    width_pixels = ?,
                    height_pixels = ?,
                    fps = ?,
                    codec = ?,
                    metadata_json = ?,
                    thumbnail_path = ?,
                    thumbnail_generated_at_ms = ?,
                    updated_at_ms = ?,
                    last_error_code = ?,
                    last_error_message = ?
              WHERE id = ?`
          )
          .run(
            input.status,
            basename(targetPath ?? sourcePath),
            extension,
            sourcePath,
            targetPath,
            normalizedSourcePath,
            normalizedTargetPath,
            input.sizeBytes,
            input.modifiedAtMs,
            input.fileCreatedAtMs,
            input.durationMs,
            input.widthPixels,
            input.heightPixels,
            input.fps,
            input.codec,
            input.metadataJson,
            input.thumbnailPath,
            input.thumbnailGeneratedAtMs,
            timestamp,
            input.lastErrorCode,
            input.lastErrorMessage,
            existing.id
          )
      } else {
        this.database
          .prepare(
            `INSERT INTO clips (
               id, source_id, import_mode, status, display_name, extension, source_path, target_path,
               normalized_source_path, normalized_target_path, size_bytes, modified_at_ms,
               file_created_at_ms, duration_ms, width_pixels, height_pixels, fps, codec,
               metadata_json, thumbnail_path, thumbnail_generated_at_ms, favorite, note,
               created_at_ms, updated_at_ms, last_error_code, last_error_message
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, ?, ?, ?)`
          )
          .run(
            this.createId(),
            input.sourceId,
            input.importMode,
            input.status,
            basename(targetPath ?? sourcePath),
            extension,
            sourcePath,
            targetPath,
            normalizedSourcePath,
            normalizedTargetPath,
            input.sizeBytes,
            input.modifiedAtMs,
            input.fileCreatedAtMs,
            input.durationMs,
            input.widthPixels,
            input.heightPixels,
            input.fps,
            input.codec,
            input.metadataJson,
            input.thumbnailPath,
            input.thumbnailGeneratedAtMs,
            timestamp,
            timestamp,
            input.lastErrorCode,
            input.lastErrorMessage
          )
      }

      this.database.exec('COMMIT')

      const row = this.readClipByNormalized(
        input.importMode,
        normalizedSourcePath,
        normalizedTargetPath
      )

      if (!row) {
        return fail(
          'LIBRARY_PERSIST_FAILED',
          'persist',
          'The scanned clip record could not be reloaded.',
          {
            sourcePath
          }
        )
      }

      this.refreshSearchRow(row.id)

      return ok({
        clip: clipSummaryFromRow(row, this.readTagsForClip(row.id)),
        created: !existing,
        updated: Boolean(existing)
      })
    } catch {
      safeRollback(this.database)
      return fail(
        'LIBRARY_PERSIST_FAILED',
        'persist',
        'The scanned clip record could not be saved.',
        {
          sourcePath
        }
      )
    }
  }

  toggleFavorite(clipId: string): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('update')

    if (!openResult.ok) {
      return openResult
    }

    const row = this.readClipById(clipId)

    if (!row) {
      return fail('CLIP_NOT_FOUND', 'update', 'The selected clip is no longer in the library.')
    }

    try {
      this.database
        .prepare('UPDATE clips SET favorite = ?, updated_at_ms = ? WHERE id = ?')
        .run(row.favorite === SQLITE_TRUE ? SQLITE_FALSE : SQLITE_TRUE, nowMs(this.now), clipId)
      this.refreshSearchRow(clipId)
      return this.snapshot()
    } catch {
      return fail('CLIP_UPDATE_FAILED', 'update', 'ClipDock could not update the favorite state.')
    }
  }

  updateClipTags(clipId: string, tags: string[]): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('update')

    if (!openResult.ok) {
      return openResult
    }

    if (!this.readClipById(clipId)) {
      return fail('CLIP_NOT_FOUND', 'update', 'The selected clip is no longer in the library.')
    }

    const normalizedNames = [...new Set(tags.map(normalizeTagName).filter(Boolean))]

    try {
      this.database.exec('BEGIN IMMEDIATE')
      this.database.prepare('DELETE FROM clip_tags WHERE clip_id = ?').run(clipId)

      const timestamp = nowMs(this.now)

      for (const tagName of normalizedNames) {
        const normalizedName = normalizeTagKey(tagName)
        const existingTag = this.database
          .prepare('SELECT * FROM tags WHERE normalized_name = ?')
          .get(normalizedName) as TagRow | undefined
        const tagId = existingTag?.id ?? this.createId()

        if (!existingTag) {
          this.database
            .prepare(
              `INSERT INTO tags (id, name, normalized_name, color, created_at_ms, updated_at_ms)
               VALUES (?, ?, ?, NULL, ?, ?)`
            )
            .run(tagId, tagName, normalizedName, timestamp, timestamp)
        }

        this.database
          .prepare(
            'INSERT OR IGNORE INTO clip_tags (clip_id, tag_id, created_at_ms) VALUES (?, ?, ?)'
          )
          .run(clipId, tagId, timestamp)
      }

      this.database
        .prepare('UPDATE clips SET updated_at_ms = ? WHERE id = ?')
        .run(timestamp, clipId)
      this.database.exec('COMMIT')
      this.refreshSearchRow(clipId)
      return this.snapshot()
    } catch {
      safeRollback(this.database)
      return fail('CLIP_UPDATE_FAILED', 'update', 'ClipDock could not update clip tags.')
    }
  }

  updateClipNote(clipId: string, note: string): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('update')

    if (!openResult.ok) {
      return openResult
    }

    if (!this.readClipById(clipId)) {
      return fail('CLIP_NOT_FOUND', 'update', 'The selected clip is no longer in the library.')
    }

    try {
      this.database
        .prepare('UPDATE clips SET note = ?, updated_at_ms = ? WHERE id = ?')
        .run(boundedNote(note), nowMs(this.now), clipId)
      this.refreshSearchRow(clipId)
      return this.snapshot()
    } catch {
      return fail('CLIP_UPDATE_FAILED', 'update', 'ClipDock could not update the clip note.')
    }
  }

  createBin(name: string): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('bin')

    if (!openResult.ok) {
      return openResult
    }

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

    if (!openResult.ok) {
      return openResult
    }

    const cleanName = boundedBinName(name)
    const normalizedName = normalizeBinKey(cleanName)

    if (!binId.trim() || !normalizedName) {
      return fail('LIBRARY_INVALID_INPUT', 'bin', 'A valid bin id and name are required.')
    }

    try {
      const result = this.database
        .prepare('UPDATE bins SET name = ?, normalized_name = ?, updated_at_ms = ? WHERE id = ?')
        .run(cleanName, normalizedName, nowMs(this.now), binId)

      if (result.changes === 0) {
        return fail('BIN_NOT_FOUND', 'bin', 'The selected bin was not found.')
      }

      return this.snapshot()
    } catch {
      return fail('BIN_DUPLICATE_NAME', 'bin', 'A bin with that name already exists.')
    }
  }

  deleteBin(binId: string): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('bin')

    if (!openResult.ok) {
      return openResult
    }

    try {
      const result = this.database.prepare('DELETE FROM bins WHERE id = ?').run(binId)

      if (result.changes === 0) {
        return fail('BIN_NOT_FOUND', 'bin', 'The selected bin was not found.')
      }

      return this.snapshot()
    } catch {
      return fail('BIN_UPDATE_FAILED', 'bin', 'ClipDock could not delete the bin.')
    }
  }

  addClipsToBin(clipIds: string[], binId: string): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('bin')

    if (!openResult.ok) {
      return openResult
    }

    const ids = validClipIds(clipIds)

    if (ids.length === 0 || !binId.trim()) {
      return fail('LIBRARY_INVALID_INPUT', 'bin', 'Select clips and a bin first.')
    }

    if (!this.readBinById(binId)) {
      return fail('BIN_NOT_FOUND', 'bin', 'The selected bin was not found.')
    }

    for (const clipId of ids) {
      const clip = this.readClipById(clipId)

      if (!clip || clip.status === 'removed') {
        return fail('CLIP_NOT_FOUND', 'bin', 'One selected clip is no longer in the library.')
      }
    }

    try {
      const timestamp = nowMs(this.now)
      const insert = this.database.prepare(
        'INSERT OR IGNORE INTO clip_bins (clip_id, bin_id, created_at_ms) VALUES (?, ?, ?)'
      )

      this.database.exec('BEGIN IMMEDIATE')

      for (const clipId of ids) {
        insert.run(clipId, binId, timestamp)
      }

      this.database.exec('COMMIT')

      return this.snapshot()
    } catch {
      safeRollback(this.database)
      return fail('BIN_UPDATE_FAILED', 'bin', 'ClipDock could not assign clips to the bin.')
    }
  }

  moveClipsToBin(
    clipIds: string[],
    fromBinId: string,
    toBinId: string
  ): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('bin')

    if (!openResult.ok) {
      return openResult
    }

    const ids = validClipIds(clipIds)

    if (ids.length === 0 || !fromBinId.trim() || !toBinId.trim()) {
      return fail('LIBRARY_INVALID_INPUT', 'bin', 'Select clips and bins first.')
    }

    if (!this.readBinById(fromBinId) || !this.readBinById(toBinId)) {
      return fail('BIN_NOT_FOUND', 'bin', 'The selected bin was not found.')
    }

    try {
      const timestamp = nowMs(this.now)
      const remove = this.database.prepare('DELETE FROM clip_bins WHERE clip_id = ? AND bin_id = ?')
      const insert = this.database.prepare(
        'INSERT OR IGNORE INTO clip_bins (clip_id, bin_id, created_at_ms) VALUES (?, ?, ?)'
      )

      this.database.exec('BEGIN IMMEDIATE')

      for (const clipId of ids) {
        remove.run(clipId, fromBinId)
        insert.run(clipId, toBinId, timestamp)
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

    if (!openResult.ok) {
      return openResult
    }

    const ids = validClipIds(clipIds)

    if (ids.length === 0 || !binId.trim()) {
      return fail('LIBRARY_INVALID_INPUT', 'bin', 'Select clips and a bin first.')
    }

    try {
      const remove = this.database.prepare('DELETE FROM clip_bins WHERE clip_id = ? AND bin_id = ?')

      for (const clipId of ids) {
        remove.run(clipId, binId)
      }

      return this.snapshot()
    } catch {
      return fail('BIN_UPDATE_FAILED', 'bin', 'ClipDock could not remove clips from the bin.')
    }
  }

  removeClipsFromLibrary(clipIds: string[]): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('remove')

    if (!openResult.ok) {
      return openResult
    }

    const ids = validClipIds(clipIds)

    if (ids.length === 0) {
      return fail('LIBRARY_INVALID_INPUT', 'remove', 'Select at least one clip to remove.')
    }

    try {
      const timestamp = nowMs(this.now)

      this.database.exec('BEGIN IMMEDIATE')

      for (const clipId of ids) {
        this.database.prepare('DELETE FROM clip_bins WHERE clip_id = ?').run(clipId)
        this.deleteSearchRow(clipId)
        this.database
          .prepare('UPDATE clips SET status = ?, updated_at_ms = ? WHERE id = ?')
          .run('removed', timestamp, clipId)
      }

      this.database.exec('COMMIT')

      return this.snapshot()
    } catch (error) {
      safeRollback(this.database)
      const detail = error instanceof Error ? ` ${error.message}` : ''

      return fail(
        'CLIP_REMOVE_FAILED',
        'remove',
        `ClipDock could not remove the selected clips.${detail}`
      )
    }
  }

  updateClipRotation(
    clipId: string,
    rotationDegrees: ClipRotationDegrees
  ): LibraryResult<LibrarySnapshot> {
    const openResult = this.requireOpen('update')

    if (!openResult.ok) {
      return openResult
    }

    if (!clipId.trim() || !isClipRotationDegrees(rotationDegrees)) {
      return fail('LIBRARY_INVALID_INPUT', 'update', 'A valid clip id and rotation are required.')
    }

    const clip = this.readClipById(clipId)

    if (!clip || clip.status === 'removed') {
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

  getClipRotationExport(
    input: ClipExportInput
  ): LibraryResult<LibraryClipExportRecordSummary | null> {
    const openResult = this.requireOpen('export')

    if (!openResult.ok) {
      return openResult
    }

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
      ) as unknown as ClipExportRow | undefined

    return ok(row ? clipExportSummaryFromRow(row) : null)
  }

  upsertClipRotationExport(
    input: UpsertClipExportInput
  ): LibraryResult<LibraryClipExportRecordSummary> {
    const openResult = this.requireOpen('export')

    if (!openResult.ok) {
      return openResult
    }

    try {
      const timestamp = nowMs(this.now)
      const existing = this.getClipRotationExport(input)

      if (!existing.ok) {
        return existing
      }

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
          normalizeForUnique(input.exportPath),
          existing.value?.createdAtMs ?? timestamp,
          timestamp
        )

      const saved = this.getClipRotationExport(input)

      if (!saved.ok || !saved.value) {
        return fail('CLIP_EXPORT_FAILED', 'export', 'ClipDock could not reload the export record.')
      }

      return ok(saved.value)
    } catch {
      return fail('CLIP_EXPORT_FAILED', 'export', 'ClipDock could not save the export record.')
    }
  }

  getClipDragAsset(clipId: string): LibraryResult<ClipDragAsset> {
    const openResult = this.requireOpen('drag')

    if (!openResult.ok) {
      return openResult
    }

    const row = this.readClipById(clipId)

    if (!row || row.status === 'removed') {
      return fail('CLIP_NOT_FOUND', 'drag', 'The selected clip is no longer in the library.')
    }

    const filePath = actualClipPath(row)

    if (!filePath) {
      return fail('ASSET_NOT_FOUND', 'drag', 'The selected clip asset is not available.')
    }

    return ok({
      id: row.id,
      filePath,
      sizeBytes: row.size_bytes,
      modifiedAtMs: row.modified_at_ms,
      rotationDegrees: row.rotation_degrees
    })
  }

  getClipAsset(clipId: string, kind: 'media' | 'thumbnail'): LibraryResult<string> {
    const openResult = this.requireOpen('asset')

    if (!openResult.ok) {
      return openResult
    }

    const row = this.readClipById(clipId)

    if (!row || row.status === 'removed') {
      return fail('CLIP_NOT_FOUND', 'asset', 'The selected clip is no longer in the library.')
    }

    const assetPath = kind === 'thumbnail' ? row.thumbnail_path : actualClipPath(row)

    if (!assetPath) {
      return fail('ASSET_NOT_FOUND', 'asset', 'The requested clip asset is not available.')
    }

    return ok(assetPath)
  }

  close(): LibraryResult<void> {
    if (this.closed) {
      return ok(undefined)
    }

    try {
      this.database.close()
      this.closed = true
      return ok(undefined)
    } catch {
      this.closed = true
      return fail(
        'LIBRARY_CLOSE_FAILED',
        'close',
        'The ClipDock library database could not be closed.'
      )
    }
  }

  private requireOpen(phase: LibraryImportPhase): LibraryResult<void> {
    if (this.closed) {
      return fail('LIBRARY_CLOSED', phase, 'The ClipDock library database is closed.')
    }

    return ok(undefined)
  }

  private updateSourceScanState(
    sourceId: string,
    values: Record<string, unknown>
  ): LibraryResult<void> {
    const openResult = this.requireOpen('scan')

    if (!openResult.ok) {
      return openResult
    }

    const assignments = Object.keys(values)
      .map((key) => `${key} = ?`)
      .join(', ')

    try {
      const sqlValues = Object.values(values) as Array<string | number | null>

      this.database
        .prepare(`UPDATE library_sources SET ${assignments} WHERE id = ?`)
        .run(...sqlValues, sourceId)
      return ok(undefined)
    } catch {
      return fail('LIBRARY_PERSIST_FAILED', 'scan', 'ClipDock could not update source scan state.')
    }
  }

  private readSourceById(sourceId: string): SourceRow | null {
    return (
      (this.database
        .prepare(
          `SELECT s.*, COUNT(c.id) AS clip_count
             FROM library_sources s
             LEFT JOIN clips c ON c.source_id = s.id AND c.status != 'removed'
            WHERE s.id = ?
            GROUP BY s.id`
        )
        .get(sourceId) as SourceRow | undefined) ?? null
    )
  }

  private readSourceByNormalized(
    kind: LibrarySourceKind,
    normalizedSource: string
  ): SourceRow | null {
    return (
      (this.database
        .prepare(
          `SELECT s.*, COUNT(c.id) AS clip_count
             FROM library_sources s
             LEFT JOIN clips c ON c.source_id = s.id AND c.status != 'removed'
            WHERE s.kind = ? AND s.normalized_source_path = ?
            GROUP BY s.id`
        )
        .get(kind, normalizedSource) as SourceRow | undefined) ?? null
    )
  }

  private readClipById(clipId: string): ClipRow | null {
    return (
      (this.database.prepare('SELECT * FROM clips WHERE id = ?').get(clipId) as
        | ClipRow
        | undefined) ?? null
    )
  }

  private readBinById(binId: string): BinRow | null {
    return (
      (this.database.prepare('SELECT *, 0 AS clip_count FROM bins WHERE id = ?').get(binId) as
        | BinRow
        | undefined) ?? null
    )
  }

  private readClipByTarget(normalizedTarget: string): ClipRow | null {
    return (
      (this.database
        .prepare('SELECT * FROM clips WHERE normalized_target_path = ?')
        .get(normalizedTarget) as ClipRow | undefined) ?? null
    )
  }

  private readClipByNormalized(
    importMode: ClipImportMode,
    normalizedSourcePath: string,
    normalizedTargetPath: string | null
  ): ClipRow | null {
    return (
      (this.database
        .prepare(
          `SELECT * FROM clips
            WHERE import_mode = ?
              AND (normalized_source_path = ? OR (? IS NOT NULL AND normalized_target_path = ?))
            LIMIT 1`
        )
        .get(importMode, normalizedSourcePath, normalizedTargetPath, normalizedTargetPath) as
        | ClipRow
        | undefined) ?? null
    )
  }

  private readTagsByClipId(): Map<string, string[]> {
    const rows = this.database
      .prepare(
        `SELECT ct.clip_id AS clip_id, t.name AS name
           FROM clip_tags ct
           JOIN tags t ON t.id = ct.tag_id
          ORDER BY t.name COLLATE NOCASE ASC`
      )
      .all() as Array<{ clip_id: string; name: string }>
    const tagsByClipId = new Map<string, string[]>()

    for (const row of rows) {
      const tags = tagsByClipId.get(row.clip_id) ?? []

      tags.push(row.name)
      tagsByClipId.set(row.clip_id, tags)
    }

    return tagsByClipId
  }

  private readBinIdsByClipId(): Map<string, string[]> {
    const rows = this.database
      .prepare(
        `SELECT clip_id, bin_id
           FROM clip_bins
          ORDER BY created_at_ms ASC, bin_id ASC`
      )
      .all() as unknown as ClipBinRow[]
    const byClipId = new Map<string, string[]>()

    for (const row of rows) {
      const binIds = byClipId.get(row.clip_id) ?? []

      binIds.push(row.bin_id)
      byClipId.set(row.clip_id, binIds)
    }

    return byClipId
  }

  private readBins(): BinRow[] {
    return this.database
      .prepare(
        `SELECT b.*, COUNT(c.id) AS clip_count
           FROM bins b
           LEFT JOIN clip_bins cb ON cb.bin_id = b.id
           LEFT JOIN clips c ON c.id = cb.clip_id AND c.status != 'removed'
          GROUP BY b.id
          ORDER BY b.sort_order ASC, b.name COLLATE NOCASE ASC`
      )
      .all() as unknown as BinRow[]
  }

  private readTagsForClip(clipId: string): string[] {
    return (
      this.database
        .prepare(
          `SELECT t.name
             FROM clip_tags ct
             JOIN tags t ON t.id = ct.tag_id
            WHERE ct.clip_id = ?
            ORDER BY t.name COLLATE NOCASE ASC`
        )
        .all(clipId) as Array<{ name: string }>
    ).map((row) => row.name)
  }

  private refreshSearchRow(clipId: string): void {
    const row = this.readClipById(clipId)

    if (!row) {
      return
    }

    try {
      this.database.prepare('DELETE FROM clip_search WHERE clip_id = ?').run(clipId)
      this.database
        .prepare(
          'INSERT INTO clip_search (clip_id, filename, path, tags, note) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          clipId,
          row.display_name,
          actualClipPath(row),
          this.readTagsForClip(clipId).join(' '),
          row.note
        )
    } catch {
      // FTS is best-effort; renderer-side search remains authoritative for the MVP.
    }
  }

  private deleteSearchRow(clipId: string): void {
    try {
      this.database.prepare('DELETE FROM clip_search WHERE clip_id = ?').run(clipId)
    } catch {
      // FTS is optional; absence of the virtual table must not block library mutations.
    }
  }
}

export function openLibraryStore(options: LibraryStoreOptions): LibraryResult<LibraryStore> {
  const databaseFileResult = normalizeInputLocation(options.databaseFile, 'open')

  if (!databaseFileResult.ok) {
    return databaseFileResult
  }

  const libraryRootResult = normalizeInputLocation(options.libraryDir, 'open')

  if (!libraryRootResult.ok) {
    return fail(
      libraryRootResult.error.code,
      libraryRootResult.error.phase ?? 'open',
      libraryRootResult.error.message
    )
  }

  try {
    mkdirSync(dirname(databaseFileResult.value.absolute), { recursive: true })
    mkdirSync(libraryRootResult.value.absolute, { recursive: true })
  } catch {
    return fail(
      'LIBRARY_OPEN_FAILED',
      'open',
      'The ClipDock library storage directories could not be prepared.'
    )
  }

  let database: DatabaseSync

  try {
    database = new DatabaseSync(databaseFileResult.value.absolute)
  } catch {
    return fail('LIBRARY_OPEN_FAILED', 'open', 'The ClipDock library database could not be opened.')
  }

  const store = new SqliteLibraryStore(
    database,
    libraryRootResult.value,
    options.now ?? Date.now,
    options.createId ?? randomUUID
  )
  const migration = store.migrate()

  if (!migration.ok) {
    store.close()
    return migration
  }

  return ok(store)
}

export const libraryStoreSchemaVersion = SCHEMA_VERSION
