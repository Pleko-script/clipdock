import { basename, dirname, extname, relative, sep } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AssetKind, AssetMediaType, CompatibilityLevel, OverlayMode } from '../shared/clipdock'
import { refreshAssetSearch } from './assetSearch'
import { normalizeAssetPath } from './assetSchema'

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
  ucsCatId: string | null
  ucsCategory: string | null
  ucsSubcategory: string | null
  hasAlpha: boolean
  metadataJson: string | null
}

interface ExistingAsset {
  id: string
  modified_at_ms: number
  size_bytes: number
  content_hash: string | null
  hash_size_bytes: number | null
  hash_modified_at_ms: number | null
}

export function upsertScannedAssetRecord(
  database: DatabaseSync,
  input: ScannedAssetInput,
  createId: () => string,
  timestamp: number,
  queuePreview: (assetIds: string[], priority: number, timestamp: number) => void,
  queueHash: (assetIds: string[], timestamp: number) => void
): { id: string; created: boolean } {
  const pack = database
    .prepare('SELECT root_path FROM asset_packs WHERE id = ?')
    .get(input.packId) as { root_path: string } | undefined
  if (!pack) throw new Error('Asset pack was not found.')

  const normalized = normalizeAssetPath(input.filePath)
  let existing = database
    .prepare(
      'SELECT id,modified_at_ms,size_bytes,content_hash,hash_size_bytes,hash_modified_at_ms FROM assets WHERE normalized_file_path=?'
    )
    .get(normalized) as ExistingAsset | undefined
  if (!existing) {
    const movedCandidates = database
      .prepare(
        `SELECT id,modified_at_ms,size_bytes,content_hash,hash_size_bytes,hash_modified_at_ms FROM assets
         WHERE pack_id=? AND status='missing' AND size_bytes=? AND modified_at_ms=? LIMIT 2`
      )
      .all(input.packId, input.sizeBytes, input.modifiedAtMs) as unknown as ExistingAsset[]
    if (movedCandidates.length === 1) existing = movedCandidates[0]
  }

  const id = existing?.id ?? createId()
  const relativePath = relative(pack.root_path, input.filePath)
  const categoryPath = dirname(relativePath) === '.' ? '' : dirname(relativePath)
  const changed =
    !existing ||
    existing.modified_at_ms !== input.modifiedAtMs ||
    existing.size_bytes !== input.sizeBytes
  const needsHash =
    !existing?.content_hash ||
    existing.hash_size_bytes !== input.sizeBytes ||
    existing.hash_modified_at_ms !== input.modifiedAtMs
  database
    .prepare(
      `INSERT INTO assets (
        id, pack_id, relative_path, category_path, display_name, file_path, normalized_file_path,
        extension, kind, media_type, overlay_mode, compatibility, size_bytes, modified_at_ms,
        duration_ms, width_pixels, height_pixels, fps, codec, audio_codec, sample_rate, channels,
        ucs_cat_id, ucs_category, ucs_subcategory, has_alpha, metadata_json, favorite, note, status, preview_status, thumbnail_path,
        preview_path, created_at_ms, updated_at_ms, last_error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', 'ready', 'pending', NULL, NULL, ?, ?, NULL)
      ON CONFLICT DO UPDATE SET
        pack_id=excluded.pack_id, relative_path=excluded.relative_path, category_path=excluded.category_path,
        display_name=excluded.display_name, file_path=excluded.file_path, normalized_file_path=excluded.normalized_file_path,
        extension=excluded.extension, media_type=excluded.media_type, compatibility=excluded.compatibility,
        size_bytes=excluded.size_bytes, modified_at_ms=excluded.modified_at_ms, duration_ms=excluded.duration_ms,
        width_pixels=excluded.width_pixels, height_pixels=excluded.height_pixels, fps=excluded.fps,
        codec=excluded.codec, audio_codec=excluded.audio_codec, sample_rate=excluded.sample_rate,
        channels=excluded.channels, ucs_cat_id=excluded.ucs_cat_id,
        ucs_category=excluded.ucs_category, ucs_subcategory=excluded.ucs_subcategory,
        has_alpha=excluded.has_alpha, metadata_json=excluded.metadata_json,
        status='ready', preview_status=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN 'pending' ELSE assets.preview_status END,
        thumbnail_path=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN NULL ELSE assets.thumbnail_path END,
        preview_path=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN NULL ELSE assets.preview_path END,
        poster_frame_ms=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN NULL ELSE assets.poster_frame_ms END,
        poster_path=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN NULL ELSE assets.poster_path END,
        content_hash=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN NULL ELSE assets.content_hash END,
        hash_size_bytes=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN NULL ELSE assets.hash_size_bytes END,
        hash_modified_at_ms=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN NULL ELSE assets.hash_modified_at_ms END,
        duplicate_hidden=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN 0 ELSE assets.duplicate_hidden END,
        trim_status=CASE WHEN (assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes) AND (assets.trim_start_ms IS NOT NULL OR assets.rotation_degrees != 0) THEN 'pending' ELSE assets.trim_status END,
        trim_error_message=CASE WHEN assets.modified_at_ms != excluded.modified_at_ms OR assets.size_bytes != excluded.size_bytes THEN NULL ELSE assets.trim_error_message END,
        updated_at_ms=excluded.updated_at_ms, last_error_message=NULL`
    )
    .run(
      id,
      input.packId,
      relativePath,
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
      input.ucsCatId ?? null,
      input.ucsCategory ?? null,
      input.ucsSubcategory ?? null,
      input.hasAlpha ? 1 : 0,
      input.metadataJson,
      timestamp,
      timestamp
    )
  if (changed) {
    queuePreview([id], 0, timestamp)
  }
  if (needsHash) queueHash([id], timestamp)
  refreshAssetSearch(database, id)
  return { id, created: !existing }
}

function restoreSeenAssets(database: DatabaseSync, packId: string, seenAssetIds: string[]): void {
  const restore = database.prepare(
    `UPDATE assets SET status='ready', last_error_message=NULL WHERE id=? AND pack_id=?`
  )
  for (const id of [...new Set(seenAssetIds)]) restore.run(id, packId)
}

function updatePackScanTime(database: DatabaseSync, packId: string, timestamp: number): number {
  database
    .prepare(`UPDATE asset_packs SET last_scanned_at_ms=?, updated_at_ms=? WHERE id=?`)
    .run(timestamp, timestamp, packId)
  const missing = database
    .prepare(`SELECT COUNT(*) count FROM assets WHERE pack_id=? AND status='missing'`)
    .get(packId) as { count: number }
  return Number(missing.count)
}

export function finishFullPackScan(
  database: DatabaseSync,
  packId: string,
  seenAssetIds: string[],
  timestamp: number
): number {
  if (!database.prepare('SELECT 1 FROM asset_packs WHERE id=?').get(packId))
    throw new Error('Asset pack was not found.')
  database
    .prepare(`UPDATE assets SET status='missing', updated_at_ms=? WHERE pack_id=?`)
    .run(timestamp, packId)
  restoreSeenAssets(database, packId, seenAssetIds)
  return updatePackScanTime(database, packId, timestamp)
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

export function finishIncrementalPackScan(
  database: DatabaseSync,
  packId: string,
  relativeScopes: string[],
  seenAssetIds: string[],
  timestamp: number
): number {
  if (!database.prepare('SELECT 1 FROM asset_packs WHERE id=?').get(packId))
    throw new Error('Asset pack was not found.')
  const scopes = [...new Set(relativeScopes.filter(Boolean))]
  for (let offset = 0; offset < scopes.length; offset += 250) {
    const chunk = scopes.slice(offset, offset + 250)
    const conditions = chunk.map(() => `(relative_path=? OR relative_path LIKE ? ESCAPE '\\')`)
    const params = chunk.flatMap((scope) => [scope, `${escapeLike(`${scope}${sep}`)}%`])
    database
      .prepare(
        `UPDATE assets SET status='missing', updated_at_ms=?
         WHERE pack_id=? AND (${conditions.join(' OR ')})`
      )
      .run(timestamp, packId, ...params)
  }
  restoreSeenAssets(database, packId, seenAssetIds)
  return updatePackScanTime(database, packId, timestamp)
}
