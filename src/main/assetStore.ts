import { randomUUID } from 'node:crypto'
import { mkdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { hasAssetSearchIndex, refreshAssetSearch } from './assetSearch'
import { ASSET_SCHEMA_VERSION, migrateAssetSchema, normalizeAssetPath } from './assetSchema'
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

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.database.exec('ROLLBACK')
      } catch {
        // Preserve the operation failure.
      }
      throw error
    }
  }

  private queuePreviewJobs(assetIds: string[], priority: number, timestamp: number): void {
    const ids = [...new Set(assetIds.filter(Boolean))]
    if (!ids.length) throw new Error('Select at least one asset.')
    const placeholders = ids.map(() => '?').join(',')
    const existing = this.database
      .prepare(`SELECT COUNT(*) count FROM assets WHERE id IN (${placeholders})`)
      .get(...ids) as { count: number }
    if (existing.count !== ids.length) throw new Error('One or more assets were not found.')

    const queue = this.database.prepare(
      `INSERT INTO preview_jobs VALUES (?,?, 'pending', ?, 0, NULL, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
         status='pending', priority=MAX(priority,excluded.priority),
         last_error_message=NULL, updated_at_ms=excluded.updated_at_ms`
    )
    const markPending = this.database.prepare(
      `UPDATE assets SET preview_status='pending', last_error_message=NULL, updated_at_ms=? WHERE id=?`
    )
    for (const id of ids) {
      queue.run(this.createId(), id, priority, timestamp, timestamp)
      markPending.run(timestamp, id)
    }
  }

  migrate(): ClipdockResult<void> {
    try {
      migrateAssetSchema(this.database, this.now())
      return ok(undefined)
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : 'Asset database migration failed.',
        'migrate'
      )
    }
  }

  createPack(rootPath: string): ClipdockResult<string> {
    try {
      const absolute = resolve(rootPath)
      if (!statSync(absolute).isDirectory())
        return fail('The selected pack is not a folder.', 'scan')
      const normalized = normalizeAssetPath(absolute)
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
        .get(normalizeAssetPath(absolute), packId)
      if (duplicate) return fail('This folder is already used by another pack.', 'scan')

      this.transaction(() => {
        const timestamp = this.now()
        this.database
          .prepare(
            `UPDATE asset_packs SET name = ?, root_path = ?, normalized_root_path = ?, updated_at_ms = ? WHERE id = ?`
          )
          .run(basename(absolute), absolute, normalizeAssetPath(absolute), timestamp, packId)
        const assets = this.database
          .prepare('SELECT id, relative_path FROM assets WHERE pack_id = ?')
          .all(packId) as Array<{ id: string; relative_path: string }>
        const update = this.database.prepare(
          'UPDATE assets SET file_path = ?, normalized_file_path = ?, updated_at_ms = ? WHERE id = ?'
        )
        for (const asset of assets) {
          const filePath = join(absolute, asset.relative_path)
          update.run(filePath, normalizeAssetPath(filePath), timestamp, asset.id)
        }
        const assetIds = assets.map((asset) => asset.id)
        if (assetIds.length) this.queuePreviewJobs(assetIds, 10, timestamp)
        for (const assetId of assetIds) refreshAssetSearch(this.database, assetId)
      })
      return ok(undefined)
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : 'ClipDock could not relink the pack.',
        'scan'
      )
    }
  }

  upsertScannedAsset(input: ScannedAssetInput): ClipdockResult<{ id: string; created: boolean }> {
    try {
      const saved = this.transaction(() => {
        const pack = this.database
          .prepare('SELECT root_path FROM asset_packs WHERE id = ?')
          .get(input.packId) as { root_path: string } | undefined
        if (!pack) throw new Error('Asset pack was not found.')
        const normalized = normalizeAssetPath(input.filePath)
        const existing = this.database
          .prepare(
            'SELECT id, modified_at_ms, size_bytes FROM assets WHERE normalized_file_path = ?'
          )
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
        if (changed) this.queuePreviewJobs([id], 0, timestamp)
        refreshAssetSearch(this.database, id)
        return { id, created: !existing }
      })
      return ok(saved)
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Asset could not be saved.', 'scan')
    }
  }

  finishPackScan(packId: string, seenAssetIds: string[]): ClipdockResult<number> {
    try {
      const missingCount = this.transaction(() => {
        const timestamp = this.now()
        const pack = this.database.prepare('SELECT 1 FROM asset_packs WHERE id=?').get(packId)
        if (!pack) throw new Error('Asset pack was not found.')
        this.database
          .prepare(`UPDATE assets SET status='missing', updated_at_ms=? WHERE pack_id=?`)
          .run(timestamp, packId)
        const restore = this.database.prepare(
          `UPDATE assets SET status='ready', last_error_message=NULL WHERE id=? AND pack_id=?`
        )
        for (const id of [...new Set(seenAssetIds)]) restore.run(id, packId)
        this.database
          .prepare(`UPDATE asset_packs SET last_scanned_at_ms=?, updated_at_ms=? WHERE id=?`)
          .run(timestamp, timestamp, packId)
        const missing = this.database
          .prepare(`SELECT COUNT(*) count FROM assets WHERE pack_id=? AND status='missing'`)
          .get(packId) as { count: number }
        return Number(missing.count)
      })
      return ok(missingCount)
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : 'Pack scan could not be finalized.',
        'scan'
      )
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
        const hasFts = hasAssetSearchIndex(this.database)
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
        items: this.assetSummaries(rows),
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
      this.transaction(() => {
        const placeholders = ids.map(() => '?').join(',')
        const existing = this.database
          .prepare(`SELECT COUNT(*) count FROM assets WHERE id IN (${placeholders})`)
          .get(...ids) as { count: number }
        if (existing.count !== ids.length) throw new Error('One or more assets were not found.')

        const timestamp = this.now()
        const fields: string[] = []
        const values: Array<string | number> = []
        if (request.kind) {
          fields.push('kind=?')
          values.push(request.kind)
        }
        if (request.overlayMode) {
          fields.push('overlay_mode=?')
          values.push(request.overlayMode)
        }
        if (request.kind || request.overlayMode) fields.push("preview_status='pending'")
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

        for (const id of ids) refreshAssetSearch(this.database, id)
        if (request.kind || request.overlayMode) this.queuePreviewJobs(ids, 10, timestamp)
      })
      return ok(undefined)
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Assets could not be updated.', 'update')
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
      const result = this.database.prepare('DELETE FROM collections WHERE id=?').run(collectionId)
      return result.changes ? ok(undefined) : fail('Collection was not found.', 'update')
    } catch {
      return fail('Collection could not be deleted.', 'update')
    }
  }

  addAssetsToCollection(assetIds: string[], collectionId: string): ClipdockResult<void> {
    const ids = [...new Set(assetIds.filter(Boolean))].slice(0, 256)
    if (!ids.length) return fail('Select at least one asset.', 'update')
    try {
      this.transaction(() => {
        const collection = this.database
          .prepare('SELECT 1 FROM collections WHERE id=?')
          .get(collectionId)
        if (!collection) throw new Error('Collection was not found.')
        const placeholders = ids.map(() => '?').join(',')
        const existing = this.database
          .prepare(`SELECT COUNT(*) count FROM assets WHERE id IN (${placeholders})`)
          .get(...ids) as { count: number }
        if (existing.count !== ids.length) throw new Error('One or more assets were not found.')
        const statement = this.database.prepare(
          'INSERT OR IGNORE INTO collection_assets VALUES (?,?,?)'
        )
        const timestamp = this.now()
        for (const id of ids) statement.run(collectionId, id, timestamp)
      })
      return ok(undefined)
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : 'Assets could not be added to the collection.',
        'update'
      )
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
      return row ? ok(this.assetSummaries([row])[0]) : fail('Asset was not found.')
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
      this.transaction(() => this.queuePreviewJobs(assetIds, priority, this.now()))
      return ok(undefined)
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Preview jobs could not be queued.')
    }
  }

  claimPreviewJobs(limit: number): ClipdockResult<PreviewJobRecord[]> {
    try {
      const jobs = this.transaction(() => {
        const rows = this.database
          .prepare(
            `SELECT id,asset_id,priority,attempts FROM preview_jobs WHERE status='pending' ORDER BY priority DESC, created_at_ms LIMIT ?`
          )
          .all(Math.min(8, Math.max(1, limit))) as Array<{
          id: string
          asset_id: string
          priority: number
          attempts: number
        }>
        const update = this.database.prepare(
          `UPDATE preview_jobs SET status='running', attempts=attempts+1, updated_at_ms=? WHERE id=? AND status='pending'`
        )
        const timestamp = this.now()
        for (const row of rows) update.run(timestamp, row.id)
        return rows.map((row) => ({
          id: row.id,
          assetId: row.asset_id,
          priority: row.priority,
          attempts: row.attempts + 1
        }))
      })
      return ok(jobs)
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Preview jobs could not be claimed.')
    }
  }

  completePreview(
    assetId: string,
    thumbnailPath: string,
    previewPath: string | null
  ): ClipdockResult<void> {
    try {
      this.transaction(() => {
        const updated = this.database
          .prepare(
            `UPDATE assets SET thumbnail_path=?, preview_path=?, preview_status='ready', last_error_message=NULL, updated_at_ms=? WHERE id=?`
          )
          .run(thumbnailPath, previewPath, this.now(), assetId)
        if (!updated.changes) throw new Error('Asset was not found.')
        this.database.prepare('DELETE FROM preview_jobs WHERE asset_id=?').run(assetId)
      })
      return ok(undefined)
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Preview result could not be saved.')
    }
  }

  failPreview(assetId: string, message: string): ClipdockResult<void> {
    try {
      this.transaction(() => {
        const errorMessage = message.slice(0, 1000)
        const timestamp = this.now()
        const updated = this.database
          .prepare(
            `UPDATE assets SET preview_status='failed', last_error_message=?, updated_at_ms=? WHERE id=?`
          )
          .run(errorMessage, timestamp, assetId)
        if (!updated.changes) throw new Error('Asset was not found.')
        this.database
          .prepare(
            `UPDATE preview_jobs SET status='failed', last_error_message=?, updated_at_ms=? WHERE asset_id=?`
          )
          .run(errorMessage, timestamp, assetId)
      })
      return ok(undefined)
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Preview failure could not be saved.')
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

  private assetSummaries(rows: AssetRow[]): AssetSummary[] {
    if (!rows.length) return []
    const ids = rows.map((row) => row.id)
    const placeholders = ids.map(() => '?').join(',')
    const tagRows = this.database
      .prepare(
        `SELECT at.asset_id, t.name FROM asset_tags at JOIN tags t ON t.id=at.tag_id
         WHERE at.asset_id IN (${placeholders}) ORDER BY t.name COLLATE NOCASE`
      )
      .all(...ids) as Array<{ asset_id: string; name: string }>
    const collectionRows = this.database
      .prepare(
        `SELECT asset_id, collection_id FROM collection_assets WHERE asset_id IN (${placeholders})`
      )
      .all(...ids) as Array<{ asset_id: string; collection_id: string }>
    const tags = new Map<string, string[]>()
    const collections = new Map<string, string[]>()
    for (const item of tagRows) {
      const values = tags.get(item.asset_id) ?? []
      values.push(item.name)
      tags.set(item.asset_id, values)
    }
    for (const item of collectionRows) {
      const values = collections.get(item.asset_id) ?? []
      values.push(item.collection_id)
      collections.set(item.asset_id, values)
    }
    return rows.map((row) =>
      this.assetSummary(row, tags.get(row.id) ?? [], collections.get(row.id) ?? [])
    )
  }

  private assetSummary(row: AssetRow, tags: string[], collectionIds: string[]): AssetSummary {
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
      tags,
      collectionIds,
      status: row.status,
      previewStatus: row.preview_status,
      thumbnailUrl: row.thumbnail_path ? assetUrl('thumbnail', row.id, row.updated_at_ms) : null,
      previewUrl: row.preview_path ? assetUrl('preview', row.id, row.updated_at_ms) : null,
      mediaUrl: assetUrl('media', row.id, row.updated_at_ms),
      lastErrorMessage: row.last_error_message
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
    const resumed = store.resetRunningJobs()
    if (!resumed.ok) {
      store.close()
      return resumed
    }
    return ok(store)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Asset store could not be opened.', 'open')
  }
}

export const assetStoreSchemaVersion = ASSET_SCHEMA_VERSION
