import type { DatabaseSync } from 'node:sqlite'

interface SearchSourceRow {
  display_name: string
  relative_path: string
  note: string
  pack_name: string
  ucs_cat_id: string | null
  ucs_category: string | null
  ucs_subcategory: string | null
}

export function createAssetSearchIndex(database: DatabaseSync): void {
  try {
    const existing = database
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='asset_search'`)
      .get()
    let rebuild = false
    if (existing) {
      const columns = database.prepare('PRAGMA table_info(asset_search)').all() as Array<{
        name: string
      }>
      if (!columns.some((column) => column.name === 'ucs_cat_id')) {
        database.exec('DROP TABLE asset_search')
        rebuild = true
      }
    }
    try {
      database.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(asset_id UNINDEXED, filename, pack, path, tags, note, ucs_cat_id, ucs_category, ucs_subcategory)`
      )
    } catch {
      database.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts4(asset_id, filename, pack, path, tags, note, ucs_cat_id, ucs_category, ucs_subcategory, notindexed=asset_id)`
      )
    }
    const assetCount = Number(
      (database.prepare('SELECT COUNT(*) count FROM assets').get() as { count: number }).count
    )
    const searchCount = Number(
      (database.prepare('SELECT COUNT(*) count FROM asset_search').get() as { count: number }).count
    )
    if (rebuild || assetCount !== searchCount) {
      const assets = database.prepare('SELECT id FROM assets').all() as Array<{ id: string }>
      const indexed = new Set(
        (
          database.prepare('SELECT asset_id FROM asset_search').all() as Array<{ asset_id: string }>
        ).map((row) => row.asset_id)
      )
      for (const asset of assets) if (!indexed.has(asset.id)) refreshAssetSearch(database, asset.id)
    }
  } catch {
    // Some SQLite builds omit full-text search; queryAssets keeps a LIKE fallback.
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
      `SELECT a.display_name, a.relative_path, a.note, p.name pack_name,
              a.ucs_cat_id, a.ucs_category, a.ucs_subcategory
       FROM assets a JOIN asset_packs p ON p.id=a.pack_id WHERE a.id=?`
    )
    .get(assetId) as SearchSourceRow | undefined
  if (!row) return
  const tags = database
    .prepare(`SELECT t.name FROM tags t JOIN asset_tags at ON at.tag_id=t.id WHERE at.asset_id=?`)
    .all(assetId) as Array<{ name: string }>
  database.prepare('DELETE FROM asset_search WHERE asset_id=?').run(assetId)
  database
    .prepare('INSERT INTO asset_search VALUES (?,?,?,?,?,?,?,?,?)')
    .run(
      assetId,
      row.display_name,
      row.pack_name,
      row.relative_path,
      tags.map((tag) => tag.name).join(' '),
      row.note,
      row.ucs_cat_id ?? '',
      row.ucs_category ?? '',
      row.ucs_subcategory ?? ''
    )
}
