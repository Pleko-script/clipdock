import { randomUUID } from 'node:crypto'
import { mkdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  AssetKind,
  AssetMediaType,
  AssetNavigationSnapshot,
  AssetPage,
  AssetPackSummary,
  AssetQuery,
  AssetStatus,
  AssetSummary,
  AssetUpdateRequest,
  ClipdockResult,
  CompatibilityLevel,
  OverlayMode,
  PreviewStatus
} from '../shared/clipdock'

const ASSET_SCHEMA_VERSION = 4
const DEFAULT_PAGE_SIZE = 200

export interface AssetStoreOptions {
  databaseFile: string
  previewCacheDir: string
  now?: () => number
  createId?: () => string
}

export interface ScannedAssetInput {
  packId: string
  filePath: string
  kind: AssetKind
  mediaType: AssetMediaType
  overlayMode: OverlayMode
  compatibility: CompatibilityLevel
  sizeBytes: number
  modifiedAtMs: number
  durationMs: number | null
  widthPixels: number | null
  heightPixels: number | null
  fps: number | null
  codec: string | null
  audioCodec: string | null
  sampleRate: number | null
  channels: number | null
  hasAlpha: boolean
  metadataJson: string | null
}

export interface StoredAssetPath {
  id: string
  filePath: string
  mediaType: AssetMediaType
  status: AssetStatus
}

export interface PreviewJobRecord {
  id: string
  assetId: string
  status: 'pending' | 'running' | 'failed'
  priority: number
  attempts: number
}

export interface AssetStore {
  createPack: (rootPath: string) => ClipdockResult<string>
  relinkPack: (packId: string, rootPath: string) => ClipdockResult<void>
  listPacks: (packIds?: string[]) => ClipdockResult<AssetPackSummary[]>
  upsertScannedAsset: (input: ScannedAssetInput) => ClipdockResult<{ id: string; created: boolean }>
  finishPackScan: (packId: string, seenAssetIds: string[]) => ClipdockResult<number>
  queryAssets: (query: AssetQuery) => ClipdockResult<AssetPage>
  navigation: () => ClipdockResult<AssetNavigationSnapshot>
  updateAssets: (request: AssetUpdateRequest) => ClipdockResult<void>
  toggleFavorite: (assetId: string) => ClipdockResult<void>
  createCollection: (name: string) => ClipdockResult<void>
  renameCollection: (collectionId: string, name: string) => ClipdockResult<void>
  deleteCollection: (collectionId: string) => ClipdockResult<void>
  addAssetsToCollection: (assetIds: string[], collectionId: string) => ClipdockResult<void>
  getAssetPath: (assetId: string) => ClipdockResult<StoredAssetPath>
  getAsset: (assetId: string) => ClipdockResult<AssetSummary>
  resolveAssetPath: (
    assetId: string,
    kind: 'media' | 'thumbnail' | 'preview'
  ) => ClipdockResult<string>
  enqueuePreview: (assetIds: string[], priority?: number) => ClipdockResult<void>
  claimPreviewJobs: (limit: number) => ClipdockResult<PreviewJobRecord[]>
  completePreview: (
    assetId: string,
    thumbnailPath: string,
    previewPath: string | null
  ) => ClipdockResult<void>
  failPreview: (assetId: string, message: string) => ClipdockResult<void>
  resetRunningJobs: () => ClipdockResult<void>
  close: () => void
}

interface AssetRow {
  id: string
  pack_id: string
  pack_name: string
  relative_path: string
  category_path: string
  display_name: string
  file_path: string
  extension: string
  kind: AssetKind
  media_type: AssetMediaType
  overlay_mode: OverlayMode
  compatibility: CompatibilityLevel
  size_bytes: number
  modified_at_ms: number
  duration_ms: number | null
  width_pixels: number | null
  height_pixels: number | null
  fps: number | null
  codec: string | null
  audio_codec: string | null
  sample_rate: number | null
  channels: number | null
  has_alpha: number
  favorite: number
  note: string
  status: AssetStatus
  preview_status: PreviewStatus
  thumbnail_path: string | null
  preview_path: string | null
  updated_at_ms: number
  last_error_message: string | null
}

function ok<T>(value: T): ClipdockResult<T> {
  return { ok: true, value }
}

function fail<T>(
  message: string,
  phase: 'open' | 'migrate' | 'asset' | 'scan' | 'update' = 'asset'
): ClipdockResult<T> {
  return { ok: false, error: { code: 'LIBRARY_PERSIST_FAILED', phase, message } }
}

function normalizedPath(filePath: string): string {
  const absolute = resolve(filePath)
  return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}

function assetUrl(kind: 'media' | 'thumbnail' | 'preview', id: string, stamp: number): string {
  return `clipdock-media://${kind}/${encodeURIComponent(id)}?v=${stamp}`
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').slice(0, 64)
}

class SqliteAssetStore implements AssetStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number,
    private readonly createId: () => string
  ) {}

  migrate(): ClipdockResult<void> {
    const timestamp = this.now()

    try {
      this.database.exec('PRAGMA foreign_keys = ON')
      this.database.exec('PRAGMA journal_mode = WAL')
      this.database.exec('BEGIN IMMEDIATE')
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS asset_packs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root_path TEXT NOT NULL,
          normalized_root_path TEXT NOT NULL UNIQUE,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          last_scanned_at_ms INTEGER
        );
        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY,
          pack_id TEXT NOT NULL REFERENCES asset_packs(id) ON DELETE CASCADE,
          relative_path TEXT NOT NULL,
          category_path TEXT NOT NULL DEFAULT '',
          display_name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          normalized_file_path TEXT NOT NULL UNIQUE,
          extension TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'unknown' CHECK (kind IN ('transition','overlay','sound','unknown')),
          media_type TEXT NOT NULL CHECK (media_type IN ('video','audio')),
          overlay_mode TEXT NOT NULL DEFAULT 'raw' CHECK (overlay_mode IN ('alpha','screen','raw')),
          compatibility TEXT NOT NULL DEFAULT 'expected' CHECK (compatibility IN ('verified','expected','unsupported')),
          size_bytes INTEGER NOT NULL,
          modified_at_ms INTEGER NOT NULL,
          duration_ms INTEGER,
          width_pixels INTEGER,
          height_pixels INTEGER,
          fps REAL,
          codec TEXT,
          audio_codec TEXT,
          sample_rate INTEGER,
          channels INTEGER,
          has_alpha INTEGER NOT NULL DEFAULT 0 CHECK (has_alpha IN (0,1)),
          metadata_json TEXT,
          favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
          note TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','missing','error')),
          preview_status TEXT NOT NULL DEFAULT 'pending' CHECK (preview_status IN ('pending','ready','failed')),
          thumbnail_path TEXT,
          preview_path TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          last_error_message TEXT
        );
        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL UNIQUE,
          color TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS asset_tags (
          asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          created_at_ms INTEGER NOT NULL,
          PRIMARY KEY (asset_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL UNIQUE,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collection_assets (
          collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          created_at_ms INTEGER NOT NULL,
          PRIMARY KEY (collection_id, asset_id)
        );
        CREATE TABLE IF NOT EXISTS preview_jobs (
          id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','failed')),
          priority INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error_message TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_assets_pack_status ON assets(pack_id, status);
        CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
        CREATE INDEX IF NOT EXISTS idx_assets_favorite ON assets(favorite);
        CREATE INDEX IF NOT EXISTS idx_assets_modified ON assets(modified_at_ms DESC);
        CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_collection_assets_asset ON collection_assets(asset_id);
        CREATE INDEX IF NOT EXISTS idx_preview_jobs_queue ON preview_jobs(status, priority DESC, created_at_ms);
      `)

      try {
        this.database.exec(
          `CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(asset_id UNINDEXED, filename, pack, path, tags, note);`
        )
      } catch {
        // LIKE search remains available on SQLite builds without FTS5.
      }

      this.migrateLegacy(timestamp)
      this.database.exec('COMMIT')
      this.database.exec(`PRAGMA user_version = ${ASSET_SCHEMA_VERSION}`)
      return ok(undefined)
    } catch (error) {
      try {
        this.database.exec('ROLLBACK')
      } catch {
        // Preserve the migration error.
      }
      return fail(
        error instanceof Error ? error.message : 'Asset database migration failed.',
        'migrate'
      )
    }
  }

  private migrateLegacy(timestamp: number): void {
    const tables = this.database
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>
    const names = new Set(tables.map((table) => table.name))
    if (!names.has('library_sources') || !names.has('clips')) return

    const sources = this.database
      .prepare(`SELECT * FROM library_sources WHERE status != 'removed'`)
      .all() as Array<{
      id: string
      display_name: string
      source_path: string
      target_path: string | null
      created_at_ms: number
      updated_at_ms: number
      last_scanned_at_ms: number | null
    }>

    for (const source of sources) {
      const candidate = source.target_path ?? source.source_path
      let rootPath = candidate
      try {
        if (statSync(candidate).isFile()) rootPath = dirname(candidate)
      } catch {
        rootPath = extname(candidate) ? dirname(candidate) : candidate
      }
      this.database
        .prepare(`INSERT OR IGNORE INTO asset_packs VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(
          source.id,
          source.display_name,
          rootPath,
          normalizedPath(rootPath),
          source.created_at_ms,
          source.updated_at_ms,
          source.last_scanned_at_ms
        )
    }

    const clips = this.database
      .prepare(`SELECT * FROM clips WHERE status != 'removed'`)
      .all() as Array<Record<string, unknown>>
    for (const clip of clips) {
      const packId = String(clip.source_id)
      const pack = this.database
        .prepare('SELECT root_path FROM asset_packs WHERE id = ?')
        .get(packId) as { root_path: string } | undefined
      if (!pack) continue
      const filePath = String(clip.target_path ?? clip.source_path)
      const rel = relative(pack.root_path, filePath)
      const categoryPath = dirname(rel) === '.' ? '' : dirname(rel)
      const status: AssetStatus =
        clip.status === 'missing' ? 'missing' : clip.status === 'error' ? 'error' : 'ready'
      this.database
        .prepare(
          `
        INSERT OR IGNORE INTO assets (
          id, pack_id, relative_path, category_path, display_name, file_path, normalized_file_path,
          extension, kind, media_type, overlay_mode, compatibility, size_bytes, modified_at_ms,
          duration_ms, width_pixels, height_pixels, fps, codec, audio_codec, sample_rate, channels,
          has_alpha, metadata_json, favorite, note, status, preview_status, thumbnail_path,
          preview_path, created_at_ms, updated_at_ms, last_error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 'video', 'raw', 'expected', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `
        )
        .run(
          String(clip.id),
          packId,
          rel,
          categoryPath,
          String(clip.display_name),
          filePath,
          normalizedPath(filePath),
          String(clip.extension),
          Number(clip.size_bytes),
          Number(clip.modified_at_ms),
          clip.duration_ms == null ? null : Number(clip.duration_ms),
          clip.width_pixels == null ? null : Number(clip.width_pixels),
          clip.height_pixels == null ? null : Number(clip.height_pixels),
          clip.fps == null ? null : Number(clip.fps),
          clip.codec == null ? null : String(clip.codec),
          clip.metadata_json == null ? null : String(clip.metadata_json),
          Number(clip.favorite ?? 0),
          String(clip.note ?? ''),
          status,
          clip.thumbnail_path ? 'ready' : 'pending',
          clip.thumbnail_path == null ? null : String(clip.thumbnail_path),
          Number(clip.created_at_ms ?? timestamp),
          Number(clip.updated_at_ms ?? timestamp),
          clip.last_error_message == null ? null : String(clip.last_error_message)
        )
    }

    if (names.has('clip_tags')) {
      this.database.exec(
        `INSERT OR IGNORE INTO asset_tags SELECT clip_id, tag_id, created_at_ms FROM clip_tags WHERE clip_id IN (SELECT id FROM assets)`
      )
    }
    if (names.has('bins')) {
      this.database.exec(
        `INSERT OR IGNORE INTO collections SELECT id, name, normalized_name, created_at_ms, updated_at_ms FROM bins`
      )
    }
    if (names.has('clip_bins')) {
      this.database.exec(
        `INSERT OR IGNORE INTO collection_assets SELECT bin_id, clip_id, created_at_ms FROM clip_bins WHERE clip_id IN (SELECT id FROM assets)`
      )
    }

    const assetIds = this.database.prepare('SELECT id FROM assets').all() as Array<{ id: string }>
    for (const { id } of assetIds) this.refreshSearch(id)
    this.database.exec(`
      INSERT OR IGNORE INTO preview_jobs (id, asset_id, status, priority, attempts, last_error_message, created_at_ms, updated_at_ms)
      SELECT lower(hex(randomblob(16))), id, 'pending', 0, 0, NULL, ${timestamp}, ${timestamp}
      FROM assets WHERE preview_status = 'pending'
    `)
  }

  createPack(rootPath: string): ClipdockResult<string> {
    try {
      const absolute = resolve(rootPath)
      if (!statSync(absolute).isDirectory())
        return fail('The selected pack is not a folder.', 'scan')
      const normalized = normalizedPath(absolute)
      const existing = this.database
        .prepare('SELECT id FROM asset_packs WHERE normalized_root_path = ?')
        .get(normalized) as { id: string } | undefined
      if (existing) return ok(existing.id)
      const id = this.createId()
      const timestamp = this.now()
      this.database
        .prepare(`INSERT INTO asset_packs VALUES (?, ?, ?, ?, ?, ?, NULL)`)
        .run(id, basename(absolute), absolute, normalized, timestamp, timestamp)
      return ok(id)
    } catch {
      return fail('ClipDock could not add the selected pack.', 'scan')
    }
  }

  listPacks(packIds: string[] = []): ClipdockResult<AssetPackSummary[]> {
    try {
      const params: string[] = []
      const filter = packIds.length > 0 ? `WHERE p.id IN (${packIds.map(() => '?').join(',')})` : ''
      params.push(...packIds)
      const rows = this.database
        .prepare(
          `
        SELECT p.*, COUNT(a.id) asset_count,
               SUM(CASE WHEN a.status = 'missing' THEN 1 ELSE 0 END) missing_count
        FROM asset_packs p LEFT JOIN assets a ON a.pack_id = p.id
        ${filter} GROUP BY p.id ORDER BY p.name COLLATE NOCASE
      `
        )
        .all(...params) as Array<Record<string, unknown>>
      return ok(rows.map((row) => this.packSummary(row)))
    } catch {
      return fail('ClipDock could not list packs.')
    }
  }

  relinkPack(packId: string, rootPath: string): ClipdockResult<void> {
    try {
      const absolute = resolve(rootPath)
      if (!statSync(absolute).isDirectory())
        return fail('The selected location is not a folder.', 'scan')
      const pack = this.database.prepare('SELECT id FROM asset_packs WHERE id = ?').get(packId)
      if (!pack) return fail('Asset pack was not found.', 'scan')
      const duplicate = this.database
        .prepare('SELECT id FROM asset_packs WHERE normalized_root_path = ? AND id != ?')
        .get(normalizedPath(absolute), packId)
      if (duplicate) return fail('This folder is already used by another pack.', 'scan')

      this.database.exec('BEGIN IMMEDIATE')
      try {
        const timestamp = this.now()
        this.database
          .prepare(
            `UPDATE asset_packs SET name = ?, root_path = ?, normalized_root_path = ?, updated_at_ms = ? WHERE id = ?`
          )
          .run(basename(absolute), absolute, normalizedPath(absolute), timestamp, packId)
        const assets = this.database
          .prepare('SELECT id, relative_path FROM assets WHERE pack_id = ?')
          .all(packId) as Array<{ id: string; relative_path: string }>
        const update = this.database.prepare(
          'UPDATE assets SET file_path = ?, normalized_file_path = ?, updated_at_ms = ? WHERE id = ?'
        )
        for (const asset of assets) {
          const filePath = join(absolute, asset.relative_path)
          update.run(filePath, normalizedPath(filePath), timestamp, asset.id)
        }
        this.database.exec('COMMIT')
        return ok(undefined)
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : 'ClipDock could not relink the pack.',
        'scan'
      )
    }
  }

  upsertScannedAsset(input: ScannedAssetInput): ClipdockResult<{ id: string; created: boolean }> {
    try {
      const pack = this.database
        .prepare('SELECT root_path FROM asset_packs WHERE id = ?')
        .get(input.packId) as { root_path: string } | undefined
      if (!pack) return fail('Asset pack was not found.', 'scan')
      const normalized = normalizedPath(input.filePath)
      const existing = this.database
        .prepare('SELECT id, modified_at_ms, size_bytes FROM assets WHERE normalized_file_path = ?')
        .get(normalized) as { id: string; modified_at_ms: number; size_bytes: number } | undefined
      const id = existing?.id ?? this.createId()
      const timestamp = this.now()
      const rel = relative(pack.root_path, input.filePath)
      const categoryPath = dirname(rel) === '.' ? '' : dirname(rel)
      const changed =
        !existing ||
        existing.modified_at_ms !== input.modifiedAtMs ||
        existing.size_bytes !== input.sizeBytes
      this.database
        .prepare(
          `
        INSERT INTO assets (
          id, pack_id, relative_path, category_path, display_name, file_path, normalized_file_path,
          extension, kind, media_type, overlay_mode, compatibility, size_bytes, modified_at_ms,
          duration_ms, width_pixels, height_pixels, fps, codec, audio_codec, sample_rate, channels,
          has_alpha, metadata_json, favorite, note, status, preview_status, thumbnail_path,
          preview_path, created_at_ms, updated_at_ms, last_error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', 'ready', 'pending', NULL, NULL, ?, ?, NULL)
        ON CONFLICT(normalized_file_path) DO UPDATE SET
          pack_id=excluded.pack_id, relative_path=excluded.relative_path, category_path=excluded.category_path,
          display_name=excluded.display_name, file_path=excluded.file_path, extension=excluded.extension,
          media_type=excluded.media_type, compatibility=excluded.compatibility, size_bytes=excluded.size_bytes,
          modified_at_ms=excluded.modified_at_ms, duration_ms=excluded.duration_ms,
          width_pixels=excluded.width_pixels, height_pixels=excluded.height_pixels, fps=excluded.fps,
          codec=excluded.codec, audio_codec=excluded.audio_codec, sample_rate=excluded.sample_rate,
          channels=excluded.channels, has_alpha=excluded.has_alpha, metadata_json=excluded.metadata_json,
          status='ready', preview_status=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN 'pending' ELSE assets.preview_status END,
          thumbnail_path=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN NULL ELSE assets.thumbnail_path END,
          preview_path=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN NULL ELSE assets.preview_path END,
          updated_at_ms=excluded.updated_at_ms, last_error_message=NULL
      `
        )
        .run(
          id,
          input.packId,
          rel,
          categoryPath,
          basename(input.filePath, extname(input.filePath)),
          input.filePath,
          normalized,
          extname(input.filePath).toLowerCase(),
          input.kind,
          input.mediaType,
          input.overlayMode,
          input.compatibility,
          input.sizeBytes,
          input.modifiedAtMs,
          input.durationMs,
          input.widthPixels,
          input.heightPixels,
          input.fps,
          input.codec,
          input.audioCodec,
          input.sampleRate,
          input.channels,
          input.hasAlpha ? 1 : 0,
          input.metadataJson,
          timestamp,
          timestamp
        )
      if (changed) this.enqueuePreview([id])
      this.refreshSearch(id)
      return ok({ id, created: !existing })
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Asset could not be saved.', 'scan')
    }
  }

  finishPackScan(packId: string, seenAssetIds: string[]): ClipdockResult<number> {
    try {
      this.database.exec('BEGIN')
      this.database
        .prepare(`UPDATE assets SET status='missing', updated_at_ms=? WHERE pack_id=?`)
        .run(this.now(), packId)
      const restore = this.database.prepare(
        `UPDATE assets SET status='ready', last_error_message=NULL WHERE id=? AND pack_id=?`
      )
      for (const id of seenAssetIds) restore.run(id, packId)
      this.database
        .prepare(`UPDATE asset_packs SET last_scanned_at_ms=?, updated_at_ms=? WHERE id=?`)
        .run(this.now(), this.now(), packId)
      this.database.exec('COMMIT')
      const missing = this.database
        .prepare(`SELECT COUNT(*) count FROM assets WHERE pack_id=? AND status='missing'`)
        .get(packId) as { count: number }
      return ok(Number(missing.count))
    } catch {
      try {
        this.database.exec('ROLLBACK')
      } catch {
        // Preserve the original scan error.
      }
      return fail('Pack scan could not be finalized.', 'scan')
    }
  }

  queryAssets(query: AssetQuery): ClipdockResult<AssetPage> {
    try {
      const where: string[] = []
      const params: Array<string | number> = []
      const addIn = (column: string, values: string[] | undefined): void => {
        if (!values?.length) return
        where.push(`${column} IN (${values.map(() => '?').join(',')})`)
        params.push(...values)
      }
      addIn('a.kind', query.kinds)
      addIn('a.pack_id', query.packIds)
      addIn(
        'a.extension',
        query.formats?.map((value) => value.toLowerCase())
      )
      if (query.favoriteOnly) where.push('a.favorite = 1')
      if (query.collectionIds?.length) {
        where.push(
          `EXISTS (SELECT 1 FROM collection_assets ca WHERE ca.asset_id=a.id AND ca.collection_id IN (${query.collectionIds.map(() => '?').join(',')}))`
        )
        params.push(...query.collectionIds)
      }
      if (query.tags?.length) {
        where.push(
          `EXISTS (SELECT 1 FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id=a.id AND t.normalized_name IN (${query.tags.map(() => '?').join(',')}))`
        )
        params.push(...query.tags.map((tag) => normalizeTag(tag).toLocaleLowerCase('en-US')))
      }
      const search = query.search?.trim().toLocaleLowerCase('en-US')
      if (search) {
        const hasFts = Boolean(
          this.database
            .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='asset_search'`)
            .get()
        )
        const ftsTerms = search.match(/[\p{L}\p{N}_-]+/gu) ?? []
        if (hasFts && ftsTerms.length) {
          where.push(`a.id IN (SELECT asset_id FROM asset_search WHERE asset_search MATCH ?)`)
          params.push(ftsTerms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' AND '))
        } else {
          where.push(
            `(LOWER(a.display_name) LIKE ? OR LOWER(a.relative_path) LIKE ? OR LOWER(p.name) LIKE ? OR LOWER(a.note) LIKE ? OR EXISTS (SELECT 1 FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id=a.id AND LOWER(t.name) LIKE ?))`
          )
          const term = `%${search}%`
          params.push(term, term, term, term, term)
        }
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const sort = query.sort ?? 'name'
      const order =
        sort === 'modified'
          ? 'a.modified_at_ms DESC, a.id'
          : sort === 'duration'
            ? 'COALESCE(a.duration_ms,0) DESC, a.id'
            : sort === 'recent'
              ? 'a.created_at_ms DESC, a.id'
              : 'a.display_name COLLATE NOCASE, a.id'
      const limit = Math.min(200, Math.max(1, query.limit ?? DEFAULT_PAGE_SIZE))
      const offset = Math.max(0, Number(query.cursor ?? 0) || 0)
      const totalRow = this.database
        .prepare(
          `SELECT COUNT(*) count FROM assets a JOIN asset_packs p ON p.id=a.pack_id ${whereSql}`
        )
        .get(...params) as { count: number }
      const rows = this.database
        .prepare(
          `SELECT a.*, p.name pack_name FROM assets a JOIN asset_packs p ON p.id=a.pack_id ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset) as unknown as AssetRow[]
      const totalCount = Number(totalRow.count)
      return ok({
        items: rows.map((row) => this.assetSummary(row)),
        nextCursor: offset + rows.length < totalCount ? String(offset + rows.length) : null,
        totalCount
      })
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Asset query failed.')
    }
  }

  navigation(): ClipdockResult<AssetNavigationSnapshot> {
    const packs = this.listPacks()
    if (!packs.ok) return packs
    try {
      const collections = this.database
        .prepare(
          `SELECT c.*, COUNT(ca.asset_id) asset_count FROM collections c LEFT JOIN collection_assets ca ON ca.collection_id=c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE`
        )
        .all() as Array<Record<string, unknown>>
      const tags = this.database
        .prepare(
          `SELECT DISTINCT t.name FROM tags t JOIN asset_tags at ON at.tag_id=t.id ORDER BY t.name COLLATE NOCASE`
        )
        .all() as Array<{ name: string }>
      const counts = this.database
        .prepare(
          `SELECT COUNT(*) total, SUM(favorite) favorites, SUM(CASE WHEN preview_status='pending' THEN 1 ELSE 0 END) pending FROM assets`
        )
        .get() as { total: number; favorites: number | null; pending: number | null }
      return ok({
        packs: packs.value,
        collections: collections.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          assetCount: Number(row.asset_count),
          createdAtMs: Number(row.created_at_ms),
          updatedAtMs: Number(row.updated_at_ms)
        })),
        tags: tags.map((row) => row.name),
        totalAssets: Number(counts.total),
        favoriteCount: Number(counts.favorites ?? 0),
        pendingPreviewCount: Number(counts.pending ?? 0)
      })
    } catch {
      return fail('Asset navigation could not be loaded.')
    }
  }

  updateAssets(request: AssetUpdateRequest): ClipdockResult<void> {
    const ids = [...new Set(request.assetIds.filter(Boolean))].slice(0, 256)
    if (!ids.length) return fail('Select at least one asset.', 'update')
    try {
      this.database.exec('BEGIN')
      const timestamp = this.now()
      const fields: string[] = []
      const values: Array<string | number> = []
      if (request.kind) {
        fields.push('kind=?')
        values.push(request.kind)
        fields.push("preview_status='pending'")
      }
      if (request.overlayMode) {
        fields.push('overlay_mode=?')
        values.push(request.overlayMode)
        if (!request.kind) fields.push("preview_status='pending'")
      }
      if (typeof request.note === 'string') {
        fields.push('note=?')
        values.push(request.note.slice(0, 4000))
      }
      fields.push('updated_at_ms=?')
      values.push(timestamp)
      const update = this.database.prepare(`UPDATE assets SET ${fields.join(',')} WHERE id=?`)
      for (const id of ids) update.run(...values, id)
      if (request.tags) {
        const deleteTags = this.database.prepare('DELETE FROM asset_tags WHERE asset_id=?')
        const insertTag = this.database.prepare(
          `INSERT OR IGNORE INTO tags (id,name,normalized_name,color,created_at_ms,updated_at_ms) VALUES (?,?,?,NULL,?,?)`
        )
        const getTag = this.database.prepare('SELECT id FROM tags WHERE normalized_name=?')
        const attach = this.database.prepare('INSERT OR IGNORE INTO asset_tags VALUES (?,?,?)')
        for (const id of ids) {
          deleteTags.run(id)
          for (const raw of request.tags.slice(0, 32)) {
            const name = normalizeTag(raw)
            if (!name) continue
            const normalized = name.toLocaleLowerCase('en-US')
            let tag = getTag.get(normalized) as { id: string } | undefined
            if (!tag) {
              const tagId = this.createId()
              insertTag.run(tagId, name, normalized, timestamp, timestamp)
              tag = { id: tagId }
            }
            attach.run(id, tag.id, timestamp)
          }
        }
      }
      for (const id of ids) {
        this.refreshSearch(id)
        if (request.kind || request.overlayMode) this.enqueuePreview([id], 10)
      }
      this.database.exec('COMMIT')
      return ok(undefined)
    } catch {
      try {
        this.database.exec('ROLLBACK')
      } catch {
        // Preserve the original update error.
      }
      return fail('Assets could not be updated.', 'update')
    }
  }

  toggleFavorite(assetId: string): ClipdockResult<void> {
    try {
      const result = this.database
        .prepare(
          `UPDATE assets SET favorite=CASE favorite WHEN 1 THEN 0 ELSE 1 END, updated_at_ms=? WHERE id=?`
        )
        .run(this.now(), assetId)
      return result.changes ? ok(undefined) : fail('Asset was not found.', 'update')
    } catch {
      return fail('Favorite could not be updated.', 'update')
    }
  }

  createCollection(name: string): ClipdockResult<void> {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!clean) return fail('Collection name is required.', 'update')
    try {
      const timestamp = this.now()
      this.database
        .prepare('INSERT INTO collections VALUES (?,?,?,?,?)')
        .run(this.createId(), clean, clean.toLocaleLowerCase('en-US'), timestamp, timestamp)
      return ok(undefined)
    } catch {
      return fail('A collection with this name already exists.', 'update')
    }
  }

  renameCollection(collectionId: string, name: string): ClipdockResult<void> {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!clean) return fail('Collection name is required.', 'update')
    try {
      const result = this.database
        .prepare('UPDATE collections SET name=?, normalized_name=?, updated_at_ms=? WHERE id=?')
        .run(clean, clean.toLocaleLowerCase('en-US'), this.now(), collectionId)
      return result.changes ? ok(undefined) : fail('Collection was not found.', 'update')
    } catch {
      return fail('Collection could not be renamed.', 'update')
    }
  }

  deleteCollection(collectionId: string): ClipdockResult<void> {
    try {
      this.database.prepare('DELETE FROM collections WHERE id=?').run(collectionId)
      return ok(undefined)
    } catch {
      return fail('Collection could not be deleted.', 'update')
    }
  }

  addAssetsToCollection(assetIds: string[], collectionId: string): ClipdockResult<void> {
    try {
      const timestamp = this.now()
      const statement = this.database.prepare(
        'INSERT OR IGNORE INTO collection_assets VALUES (?,?,?)'
      )
      for (const id of [...new Set(assetIds)].slice(0, 256))
        statement.run(collectionId, id, timestamp)
      return ok(undefined)
    } catch {
      return fail('Assets could not be added to the collection.', 'update')
    }
  }

  getAssetPath(assetId: string): ClipdockResult<StoredAssetPath> {
    try {
      const row = this.database
        .prepare('SELECT id,file_path,media_type,status FROM assets WHERE id=?')
        .get(assetId) as
        | { id: string; file_path: string; media_type: AssetMediaType; status: AssetStatus }
        | undefined
      return row
        ? ok({ id: row.id, filePath: row.file_path, mediaType: row.media_type, status: row.status })
        : fail('Asset was not found.')
    } catch {
      return fail('Asset path could not be resolved.')
    }
  }

  getAsset(assetId: string): ClipdockResult<AssetSummary> {
    try {
      const row = this.database
        .prepare(
          `SELECT a.*, p.name pack_name FROM assets a JOIN asset_packs p ON p.id=a.pack_id WHERE a.id=?`
        )
        .get(assetId) as unknown as AssetRow | undefined
      return row ? ok(this.assetSummary(row)) : fail('Asset was not found.')
    } catch {
      return fail('Asset could not be loaded.')
    }
  }

  resolveAssetPath(
    assetId: string,
    kind: 'media' | 'thumbnail' | 'preview'
  ): ClipdockResult<string> {
    try {
      const row = this.database
        .prepare('SELECT file_path,thumbnail_path,preview_path FROM assets WHERE id=?')
        .get(assetId) as
        | { file_path: string; thumbnail_path: string | null; preview_path: string | null }
        | undefined
      if (!row) return fail('Asset was not found.')
      const value =
        kind === 'media'
          ? row.file_path
          : kind === 'thumbnail'
            ? row.thumbnail_path
            : row.preview_path
      return value ? ok(value) : fail(`Asset ${kind} is not ready.`)
    } catch {
      return fail('Asset path could not be resolved.')
    }
  }

  enqueuePreview(assetIds: string[], priority = 0): ClipdockResult<void> {
    try {
      const timestamp = this.now()
      const statement = this.database.prepare(
        `INSERT INTO preview_jobs VALUES (?,?, 'pending', ?, 0, NULL, ?, ?) ON CONFLICT(asset_id) DO UPDATE SET status='pending', priority=MAX(priority,excluded.priority), updated_at_ms=excluded.updated_at_ms`
      )
      const markPending = this.database.prepare(
        `UPDATE assets SET preview_status='pending', updated_at_ms=? WHERE id=?`
      )
      for (const id of assetIds) {
        statement.run(this.createId(), id, priority, timestamp, timestamp)
        markPending.run(timestamp, id)
      }
      return ok(undefined)
    } catch {
      return fail('Preview jobs could not be queued.')
    }
  }

  claimPreviewJobs(limit: number): ClipdockResult<PreviewJobRecord[]> {
    try {
      const rows = this.database
        .prepare(
          `SELECT id,asset_id,status,priority,attempts FROM preview_jobs WHERE status='pending' ORDER BY priority DESC, created_at_ms LIMIT ?`
        )
        .all(Math.max(1, limit)) as Array<{
        id: string
        asset_id: string
        status: 'pending'
        priority: number
        attempts: number
      }>
      const update = this.database.prepare(
        `UPDATE preview_jobs SET status='running', attempts=attempts+1, updated_at_ms=? WHERE id=?`
      )
      for (const row of rows) update.run(this.now(), row.id)
      return ok(
        rows.map((row) => ({
          id: row.id,
          assetId: row.asset_id,
          status: 'pending',
          priority: row.priority,
          attempts: row.attempts + 1
        }))
      )
    } catch {
      return fail('Preview jobs could not be claimed.')
    }
  }

  completePreview(
    assetId: string,
    thumbnailPath: string,
    previewPath: string | null
  ): ClipdockResult<void> {
    try {
      this.database
        .prepare(
          `UPDATE assets SET thumbnail_path=?, preview_path=?, preview_status='ready', last_error_message=NULL, updated_at_ms=? WHERE id=?`
        )
        .run(thumbnailPath, previewPath, this.now(), assetId)
      this.database.prepare('DELETE FROM preview_jobs WHERE asset_id=?').run(assetId)
      return ok(undefined)
    } catch {
      return fail('Preview result could not be saved.')
    }
  }

  failPreview(assetId: string, message: string): ClipdockResult<void> {
    try {
      this.database
        .prepare(
          `UPDATE assets SET preview_status='failed', last_error_message=?, updated_at_ms=? WHERE id=?`
        )
        .run(message.slice(0, 1000), this.now(), assetId)
      this.database
        .prepare(
          `UPDATE preview_jobs SET status='failed', last_error_message=?, updated_at_ms=? WHERE asset_id=?`
        )
        .run(message.slice(0, 1000), this.now(), assetId)
      return ok(undefined)
    } catch {
      return fail('Preview failure could not be saved.')
    }
  }

  resetRunningJobs(): ClipdockResult<void> {
    try {
      this.database
        .prepare(`UPDATE preview_jobs SET status='pending', updated_at_ms=? WHERE status='running'`)
        .run(this.now())
      return ok(undefined)
    } catch {
      return fail('Preview jobs could not be resumed.')
    }
  }

  close(): void {
    this.database.close()
  }

  private packSummary(row: Record<string, unknown>): AssetPackSummary {
    return {
      id: String(row.id),
      name: String(row.name),
      rootPath: String(row.root_path),
      assetCount: Number(row.asset_count ?? 0),
      missingCount: Number(row.missing_count ?? 0),
      createdAtMs: Number(row.created_at_ms),
      updatedAtMs: Number(row.updated_at_ms),
      lastScannedAtMs: row.last_scanned_at_ms === null ? null : Number(row.last_scanned_at_ms)
    }
  }

  private assetSummary(row: AssetRow): AssetSummary {
    const tags = this.database
      .prepare(
        `SELECT t.name FROM tags t JOIN asset_tags at ON at.tag_id=t.id WHERE at.asset_id=? ORDER BY t.name`
      )
      .all(row.id) as Array<{ name: string }>
    const collections = this.database
      .prepare(`SELECT collection_id id FROM collection_assets WHERE asset_id=?`)
      .all(row.id) as Array<{ id: string }>
    return {
      id: row.id,
      packId: row.pack_id,
      packName: row.pack_name,
      relativePath: row.relative_path,
      categoryPath: row.category_path,
      displayName: row.display_name,
      filePath: row.file_path,
      extension: row.extension,
      kind: row.kind,
      mediaType: row.media_type,
      overlayMode: row.overlay_mode,
      compatibility: row.compatibility,
      sizeBytes: row.size_bytes,
      modifiedAtMs: row.modified_at_ms,
      durationMs: row.duration_ms,
      widthPixels: row.width_pixels,
      heightPixels: row.height_pixels,
      fps: row.fps,
      codec: row.codec,
      audioCodec: row.audio_codec,
      sampleRate: row.sample_rate,
      channels: row.channels,
      hasAlpha: row.has_alpha === 1,
      favorite: row.favorite === 1,
      note: row.note,
      tags: tags.map((tag) => tag.name),
      collectionIds: collections.map((collection) => collection.id),
      status: row.status,
      previewStatus: row.preview_status,
      thumbnailUrl: row.thumbnail_path ? assetUrl('thumbnail', row.id, row.updated_at_ms) : null,
      previewUrl: row.preview_path ? assetUrl('preview', row.id, row.updated_at_ms) : null,
      mediaUrl: assetUrl('media', row.id, row.updated_at_ms),
      lastErrorMessage: row.last_error_message
    }
  }

  private refreshSearch(assetId: string): void {
    try {
      const row = this.database
        .prepare(
          `SELECT a.display_name,a.relative_path,a.note,p.name pack_name FROM assets a JOIN asset_packs p ON p.id=a.pack_id WHERE a.id=?`
        )
        .get(assetId) as
        | { display_name: string; relative_path: string; note: string; pack_name: string }
        | undefined
      if (!row) return
      const tags = this.database
        .prepare(
          `SELECT t.name FROM tags t JOIN asset_tags at ON at.tag_id=t.id WHERE at.asset_id=?`
        )
        .all(assetId) as Array<{ name: string }>
      this.database.prepare('DELETE FROM asset_search WHERE asset_id=?').run(assetId)
      this.database
        .prepare('INSERT INTO asset_search VALUES (?,?,?,?,?,?)')
        .run(
          assetId,
          row.display_name,
          row.pack_name,
          row.relative_path,
          tags.map((tag) => tag.name).join(' '),
          row.note
        )
    } catch {
      // FTS is optional.
    }
  }
}

export function openAssetStore(options: AssetStoreOptions): ClipdockResult<AssetStore> {
  try {
    mkdirSync(dirname(options.databaseFile), { recursive: true })
    mkdirSync(options.previewCacheDir, { recursive: true })
    const database = new DatabaseSync(resolve(options.databaseFile))
    const store = new SqliteAssetStore(
      database,
      options.now ?? Date.now,
      options.createId ?? randomUUID
    )
    const migrated = store.migrate()
    if (!migrated.ok) {
      store.close()
      return migrated
    }
    store.resetRunningJobs()
    return ok(store)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Asset store could not be opened.', 'open')
  }
}

export const assetStoreSchemaVersion = ASSET_SCHEMA_VERSION
