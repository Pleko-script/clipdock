import { statSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AssetStatus } from '../shared/clipdock'
import { createAssetSearchIndex, refreshAssetSearch } from './assetSearch'

export const ASSET_SCHEMA_VERSION = 6

interface LegacySourceRow {
  id: string
  display_name: string
  source_path: string
  target_path: string | null
  created_at_ms: number
  updated_at_ms: number
  last_scanned_at_ms: number | null
}

interface LegacyClipRow {
  id: string
  source_id: string
  status: string
  display_name: string
  source_path: string
  target_path: string | null
  extension: string
  size_bytes: number
  modified_at_ms: number
  duration_ms: number | null
  width_pixels: number | null
  height_pixels: number | null
  fps: number | null
  codec: string | null
  metadata_json: string | null
  favorite: number | null
  note: string | null
  thumbnail_path: string | null
  created_at_ms: number | null
  updated_at_ms: number | null
  last_error_message: string | null
}

export function normalizeAssetPath(filePath: string): string {
  const absolute = resolve(filePath)
  return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}

function createTables(database: DatabaseSync): void {
  database.exec(`
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
      trim_start_ms INTEGER,
      trim_end_ms INTEGER,
      rotation_degrees INTEGER NOT NULL DEFAULT 0 CHECK (rotation_degrees IN (0,90,180,270)),
      trimmed_path TEXT,
      trim_status TEXT NOT NULL DEFAULT 'none' CHECK (trim_status IN ('none','pending','ready','failed')),
      trim_error_message TEXT,
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
  createAssetSearchIndex(database)
}

function ensureTrimColumns(database: DatabaseSync): void {
  const columns = new Set(
    (database.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )
  const additions: ReadonlyArray<[string, string]> = [
    ['trim_start_ms', 'INTEGER'],
    ['trim_end_ms', 'INTEGER'],
    ['rotation_degrees', 'INTEGER NOT NULL DEFAULT 0 CHECK (rotation_degrees IN (0,90,180,270))'],
    ['trimmed_path', 'TEXT'],
    [
      'trim_status',
      "TEXT NOT NULL DEFAULT 'none' CHECK (trim_status IN ('none','pending','ready','failed'))"
    ],
    ['trim_error_message', 'TEXT']
  ]
  for (const [name, definition] of additions) {
    if (!columns.has(name)) database.exec(`ALTER TABLE assets ADD COLUMN ${name} ${definition}`)
  }
}

function legacyRootPath(source: LegacySourceRow): string {
  const candidate = source.target_path ?? source.source_path
  try {
    return statSync(candidate).isFile() ? dirname(candidate) : candidate
  } catch {
    return extname(candidate) ? dirname(candidate) : candidate
  }
}

function migrateLegacy(database: DatabaseSync, timestamp: number): void {
  const migrationKey = 'legacy_asset_migration_complete'
  if (database.prepare('SELECT 1 FROM app_settings WHERE key=?').get(migrationKey)) return
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>
  const names = new Set(tables.map((table) => table.name))
  if (!names.has('library_sources') || !names.has('clips')) {
    database
      .prepare('INSERT INTO app_settings VALUES (?, ?, ?)')
      .run(migrationKey, 'true', timestamp)
    return
  }

  const sources = database
    .prepare(`SELECT * FROM library_sources WHERE status != 'removed'`)
    .all() as unknown as LegacySourceRow[]
  const insertPack = database.prepare(`
    INSERT OR IGNORE INTO asset_packs
      (id, name, root_path, normalized_root_path, created_at_ms, updated_at_ms, last_scanned_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const source of sources) {
    const rootPath = legacyRootPath(source)
    insertPack.run(
      source.id,
      source.display_name,
      rootPath,
      normalizeAssetPath(rootPath),
      source.created_at_ms,
      source.updated_at_ms,
      source.last_scanned_at_ms
    )
  }

  const clips = database
    .prepare(`SELECT * FROM clips WHERE status != 'removed'`)
    .all() as unknown as LegacyClipRow[]
  const getPack = database.prepare('SELECT root_path FROM asset_packs WHERE id = ?')
  const insertAsset = database.prepare(`
    INSERT OR IGNORE INTO assets (
      id, pack_id, relative_path, category_path, display_name, file_path, normalized_file_path,
      extension, kind, media_type, overlay_mode, compatibility, size_bytes, modified_at_ms,
      duration_ms, width_pixels, height_pixels, fps, codec, audio_codec, sample_rate, channels,
      has_alpha, metadata_json, favorite, note, status, preview_status, thumbnail_path,
      preview_path, created_at_ms, updated_at_ms, last_error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 'video', 'raw', 'expected', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `)
  for (const clip of clips) {
    const pack = getPack.get(clip.source_id) as { root_path: string } | undefined
    if (!pack) continue
    const filePath = clip.target_path ?? clip.source_path
    const relativePath = relative(pack.root_path, filePath)
    const status: AssetStatus =
      clip.status === 'missing' ? 'missing' : clip.status === 'error' ? 'error' : 'ready'
    insertAsset.run(
      clip.id,
      clip.source_id,
      relativePath,
      dirname(relativePath) === '.' ? '' : dirname(relativePath),
      clip.display_name,
      filePath,
      normalizeAssetPath(filePath),
      clip.extension,
      clip.size_bytes,
      clip.modified_at_ms,
      clip.duration_ms,
      clip.width_pixels,
      clip.height_pixels,
      clip.fps,
      clip.codec,
      clip.metadata_json,
      clip.favorite ?? 0,
      clip.note ?? '',
      status,
      clip.thumbnail_path ? 'ready' : 'pending',
      clip.thumbnail_path,
      clip.created_at_ms ?? timestamp,
      clip.updated_at_ms ?? timestamp,
      clip.last_error_message
    )
  }

  if (names.has('clip_tags')) {
    database.exec(
      `INSERT OR IGNORE INTO asset_tags SELECT clip_id, tag_id, created_at_ms FROM clip_tags WHERE clip_id IN (SELECT id FROM assets)`
    )
  }
  if (names.has('bins')) {
    database.exec(
      `INSERT OR IGNORE INTO collections SELECT id, name, normalized_name, created_at_ms, updated_at_ms FROM bins`
    )
  }
  if (names.has('clip_bins')) {
    database.exec(
      `INSERT OR IGNORE INTO collection_assets SELECT bin_id, clip_id, created_at_ms FROM clip_bins WHERE clip_id IN (SELECT id FROM assets)`
    )
  }

  const assets = database.prepare('SELECT id FROM assets').all() as Array<{ id: string }>
  for (const asset of assets) refreshAssetSearch(database, asset.id)
  database.exec(`
    INSERT OR IGNORE INTO preview_jobs
      (id, asset_id, status, priority, attempts, last_error_message, created_at_ms, updated_at_ms)
    SELECT lower(hex(randomblob(16))), id, 'pending', 0, 0, NULL, ${timestamp}, ${timestamp}
    FROM assets WHERE preview_status = 'pending'
  `)
  database
    .prepare('INSERT OR REPLACE INTO app_settings VALUES (?, ?, ?)')
    .run(migrationKey, 'true', timestamp)
}

export function migrateAssetSchema(database: DatabaseSync, timestamp: number): void {
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('BEGIN IMMEDIATE')
  try {
    createTables(database)
    ensureTrimColumns(database)
    database.exec(
      'UPDATE assets SET rotation_degrees=0 WHERE rotation_degrees IS NULL OR rotation_degrees NOT IN (0,90,180,270)'
    )
    migrateLegacy(database, timestamp)
    database.exec('COMMIT')
    database.exec(`PRAGMA user_version = ${ASSET_SCHEMA_VERSION}`)
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // Preserve the migration failure.
    }
    throw error
  }
}
