import type { DatabaseSync } from 'node:sqlite'

export interface HashJobRecord {
  id: string
  assetId: string
  filePath: string
  sizeBytes: number
  modifiedAtMs: number
  attempts: number
}

export function queueAssetHashes(
  database: DatabaseSync,
  createId: () => string,
  assetIds: string[],
  timestamp: number
): void {
  const ids = [...new Set(assetIds.filter(Boolean))]
  if (!ids.length) throw new Error('Select at least one asset.')
  const queue = database.prepare(
    `INSERT INTO hash_jobs VALUES (?, ?, 'pending', 0, NULL, ?, ?)
     ON CONFLICT(asset_id) DO UPDATE SET
       status='pending', last_error_message=NULL, updated_at_ms=excluded.updated_at_ms`
  )
  for (const id of ids) queue.run(createId(), id, timestamp, timestamp)
}

export function claimAssetHashJobs(
  database: DatabaseSync,
  limit: number,
  timestamp: number
): HashJobRecord[] {
  const rows = database
    .prepare(
      `SELECT j.id,j.asset_id,a.file_path,a.size_bytes,a.modified_at_ms,j.attempts
       FROM hash_jobs j JOIN assets a ON a.id=j.asset_id
       WHERE j.status='pending' AND a.status='ready'
       ORDER BY j.created_at_ms LIMIT ?`
    )
    .all(Math.min(2, Math.max(1, limit))) as Array<{
    id: string
    asset_id: string
    file_path: string
    size_bytes: number
    modified_at_ms: number
    attempts: number
  }>
  const claim = database.prepare(
    `UPDATE hash_jobs SET status='running',attempts=attempts+1,updated_at_ms=?
     WHERE id=? AND status='pending'`
  )
  for (const row of rows) claim.run(timestamp, row.id)
  return rows.map((row) => ({
    id: row.id,
    assetId: row.asset_id,
    filePath: row.file_path,
    sizeBytes: row.size_bytes,
    modifiedAtMs: row.modified_at_ms,
    attempts: row.attempts + 1
  }))
}

export function completeAssetHash(
  database: DatabaseSync,
  job: HashJobRecord,
  contentHash: string,
  timestamp: number
): boolean {
  const result = database
    .prepare(
      `UPDATE assets SET content_hash=?,hash_size_bytes=size_bytes,
       hash_modified_at_ms=modified_at_ms,updated_at_ms=?
       WHERE id=? AND size_bytes=? AND modified_at_ms=?`
    )
    .run(contentHash, timestamp, job.assetId, job.sizeBytes, job.modifiedAtMs)
  if (result.changes) database.prepare('DELETE FROM hash_jobs WHERE id=?').run(job.id)
  else
    database
      .prepare(`UPDATE hash_jobs SET status='pending',updated_at_ms=? WHERE id=?`)
      .run(timestamp, job.id)
  return result.changes > 0
}

export function failAssetHash(
  database: DatabaseSync,
  jobId: string,
  message: string,
  timestamp: number
): void {
  database
    .prepare(`UPDATE hash_jobs SET status='failed',last_error_message=?,updated_at_ms=? WHERE id=?`)
    .run(message.slice(0, 1000), timestamp, jobId)
}

export function requeueAssetHash(database: DatabaseSync, jobId: string, timestamp: number): void {
  database
    .prepare(
      `UPDATE hash_jobs SET status='pending',last_error_message=NULL,updated_at_ms=? WHERE id=?`
    )
    .run(timestamp, jobId)
}

export function resetRunningAssetHashJobs(database: DatabaseSync, timestamp: number): void {
  database
    .prepare(`UPDATE hash_jobs SET status='pending',updated_at_ms=? WHERE status='running'`)
    .run(timestamp)
}
