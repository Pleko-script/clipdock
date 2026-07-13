import type { DatabaseSync } from 'node:sqlite'
import type { AssetMediaType, ClipdockResult } from '../shared/clipdock'

export function persistAssetPoster(
  database: DatabaseSync,
  assetId: string,
  frameMs: number | null,
  posterPath: string | null,
  timestamp: number
): ClipdockResult<string | null> {
  database.exec('BEGIN IMMEDIATE')
  try {
    const asset = database
      .prepare('SELECT media_type,poster_path FROM assets WHERE id=?')
      .get(assetId) as { media_type: AssetMediaType; poster_path: string | null } | undefined
    if (!asset) throw new Error('Asset was not found.')
    if (frameMs !== null && (asset.media_type !== 'video' || !posterPath))
      throw new Error('Poster frames require a video asset.')
    database
      .prepare('UPDATE assets SET poster_frame_ms=?, poster_path=?, updated_at_ms=? WHERE id=?')
      .run(frameMs, posterPath, timestamp, assetId)
    database.exec('COMMIT')
    return { ok: true, value: asset.poster_path }
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // Preserve the original persistence failure.
    }
    return {
      ok: false,
      error: {
        code: 'LIBRARY_PERSIST_FAILED',
        phase: 'asset',
        message: error instanceof Error ? error.message : 'Poster frame could not be saved.'
      }
    }
  }
}
