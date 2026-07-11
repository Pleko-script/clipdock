import type { DatabaseSync } from 'node:sqlite'
import { MIN_VIDEO_TRIM_MS, type ClipdockResult, type VideoRotation } from '../shared/clipdock'

export interface AssetTrimSource {
  id: string
  filePath: string
  displayName: string
  sizeBytes: number
  modifiedAtMs: number
  durationMs: number
  hasAlpha: boolean
  previousTrimmedPath: string | null
}

interface TrimSourceRow {
  id: string
  file_path: string
  display_name: string
  media_type: 'video' | 'audio'
  status: 'ready' | 'missing' | 'error'
  size_bytes: number
  modified_at_ms: number
  duration_ms: number | null
  has_alpha: number
  trimmed_path: string | null
}

function ok<T>(value: T): ClipdockResult<T> {
  return { ok: true, value }
}

function fail<T>(message: string): ClipdockResult<T> {
  return {
    ok: false,
    error: { code: 'LIBRARY_PERSIST_FAILED', phase: 'update', message }
  }
}

function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    database.exec('COMMIT')
    return result
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // Preserve the original operation failure.
    }
    throw error
  }
}

export function beginAssetTrim(
  database: DatabaseSync,
  assetId: string,
  startMs: number | null,
  endMs: number | null,
  rotationDegrees: VideoRotation,
  timestamp: number
): ClipdockResult<AssetTrimSource> {
  try {
    const source = transaction(database, () => {
      const row = database
        .prepare(
          `SELECT id,file_path,display_name,media_type,status,size_bytes,modified_at_ms,
                  duration_ms,has_alpha,trimmed_path FROM assets WHERE id=?`
        )
        .get(assetId) as TrimSourceRow | undefined
      if (!row) throw new Error('Asset was not found.')
      if (row.media_type !== 'video') throw new Error('Only video assets can be trimmed.')
      if (row.status !== 'ready') throw new Error('The video is not available for trimming.')
      if (!row.duration_ms || row.duration_ms < MIN_VIDEO_TRIM_MS)
        throw new Error('The video duration is unavailable or too short.')
      const hasRange = startMs !== null || endMs !== null
      if (hasRange) {
        if (
          startMs === null ||
          endMs === null ||
          !Number.isInteger(startMs) ||
          !Number.isInteger(endMs) ||
          startMs < 0 ||
          endMs > row.duration_ms ||
          endMs - startMs < MIN_VIDEO_TRIM_MS
        )
          throw new Error('Choose a valid range of at least 0.1 seconds.')
      } else if (rotationDegrees === 0) {
        throw new Error('Choose a range or rotate the video before preparing it.')
      }

      const updated = database
        .prepare(
          `UPDATE assets SET trim_start_ms=?,trim_end_ms=?,rotation_degrees=?,trim_status='pending',
           trim_error_message=NULL,updated_at_ms=? WHERE id=?`
        )
        .run(startMs, endMs, rotationDegrees, timestamp, assetId)
      if (!updated.changes) throw new Error('Asset was not found.')
      return {
        id: row.id,
        filePath: row.file_path,
        displayName: row.display_name,
        sizeBytes: row.size_bytes,
        modifiedAtMs: row.modified_at_ms,
        durationMs: row.duration_ms,
        hasAlpha: row.has_alpha === 1,
        previousTrimmedPath: row.trimmed_path
      }
    })
    return ok(source)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'The trim range could not be saved.')
  }
}

export function completeAssetTrim(
  database: DatabaseSync,
  assetId: string,
  startMs: number | null,
  endMs: number | null,
  rotationDegrees: VideoRotation,
  trimmedPath: string,
  timestamp: number
): ClipdockResult<void> {
  try {
    const updated = database
      .prepare(
        `UPDATE assets SET trimmed_path=?,trim_status='ready',trim_error_message=NULL,
         updated_at_ms=? WHERE id=? AND trim_start_ms IS ? AND trim_end_ms IS ?
         AND rotation_degrees=? AND trim_status='pending'`
      )
      .run(trimmedPath, timestamp, assetId, startMs, endMs, rotationDegrees)
    return updated.changes ? ok(undefined) : fail('The trim range changed while it was rendering.')
  } catch {
    return fail('The rendered trim could not be saved.')
  }
}

export function failAssetTrim(
  database: DatabaseSync,
  assetId: string,
  startMs: number | null,
  endMs: number | null,
  rotationDegrees: VideoRotation,
  message: string,
  timestamp: number
): ClipdockResult<void> {
  try {
    database
      .prepare(
        `UPDATE assets SET trim_status='failed',trim_error_message=?,updated_at_ms=?
         WHERE id=? AND trim_start_ms IS ? AND trim_end_ms IS ?
         AND rotation_degrees=? AND trim_status='pending'`
      )
      .run(message.slice(0, 1000), timestamp, assetId, startMs, endMs, rotationDegrees)
    return ok(undefined)
  } catch {
    return fail('The trim failure could not be saved.')
  }
}

export function clearAssetTrim(
  database: DatabaseSync,
  assetId: string,
  timestamp: number
): ClipdockResult<string | null> {
  try {
    const previousPath = transaction(database, () => {
      const row = database.prepare('SELECT trimmed_path FROM assets WHERE id=?').get(assetId) as
        | { trimmed_path: string | null }
        | undefined
      if (!row) throw new Error('Asset was not found.')
      database
        .prepare(
          `UPDATE assets SET trim_start_ms=NULL,trim_end_ms=NULL,rotation_degrees=0,trimmed_path=NULL,
           trim_status='none',trim_error_message=NULL,updated_at_ms=? WHERE id=?`
        )
        .run(timestamp, assetId)
      return row.trimmed_path
    })
    return ok(previousPath)
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'The trim range could not be reset.')
  }
}
