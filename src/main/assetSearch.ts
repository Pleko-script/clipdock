import type { DatabaseSync } from 'node:sqlite'

interface SearchSourceRow {
  display_name: string
  relative_path: string
  note: string
  pack_name: string
}

export function createAssetSearchIndex(database: DatabaseSync): void {
  try {
    database.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(asset_id UNINDEXED, filename, pack, path, tags, note)`
    )
  } catch {
    // Some Node SQLite builds omit FTS5; queryAssets keeps a LIKE fallback.
  }
}

export function hasAssetSearchIndex(database: DatabaseSync): boolean {
  return Boolean(
    database.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='asset_search'`).get()
  )
}

export function refreshAssetSearch(database: DatabaseSync, assetId: string): void {
  if (!hasAssetSearchIndex(database)) return
  const row = database
    .prepare(
      `SELECT a.display_name, a.relative_path, a.note, p.name pack_name
       FROM assets a JOIN asset_packs p ON p.id=a.pack_id WHERE a.id=?`
    )
    .get(assetId) as SearchSourceRow | undefined
  if (!row) return
  const tags = database
    .prepare(`SELECT t.name FROM tags t JOIN asset_tags at ON at.tag_id=t.id WHERE at.asset_id=?`)
    .all(assetId) as Array<{ name: string }>
  database.prepare('DELETE FROM asset_search WHERE asset_id=?').run(assetId)
  database
    .prepare('INSERT INTO asset_search VALUES (?,?,?,?,?,?)')
    .run(
      assetId,
      row.display_name,
      row.pack_name,
      row.relative_path,
      tags.map((tag) => tag.name).join(' '),
      row.note
    )
}
