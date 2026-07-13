import type { DatabaseSync } from 'node:sqlite'
import type {
  AssetSmartCollectionCriteria,
  AssetSmartCollectionSaveRequest,
  AssetSmartCollectionSummary
} from '../shared/clipdock'
import { parseSmartCollectionCriteria } from './assetIpcValidation'

interface SmartCollectionRow {
  id: string
  name: string
  criteria_json: string
  created_at_ms: number
  updated_at_ms: number
}

function storedCriteria(value: string): {
  criteria: AssetSmartCollectionCriteria
  criteriaValid: boolean
} {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
    return { criteria: parseSmartCollectionCriteria(parsed), criteriaValid: true }
  } catch {
    return { criteria: parseSmartCollectionCriteria({}), criteriaValid: false }
  }
}

export function listSmartCollections(database: DatabaseSync): AssetSmartCollectionSummary[] {
  const rows = database
    .prepare('SELECT * FROM smart_collections ORDER BY name COLLATE NOCASE')
    .all() as unknown as SmartCollectionRow[]
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ...storedCriteria(row.criteria_json),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms)
  }))
}

export function saveSmartCollection(
  database: DatabaseSync,
  request: AssetSmartCollectionSaveRequest,
  timestamp: number,
  createId: () => string
): void {
  const name = request.name.trim().replace(/\s+/g, ' ').slice(0, 80)
  if (!name) throw new Error('Smart Collection name is required.')
  const criteriaJson = JSON.stringify(parseSmartCollectionCriteria(request.criteria))
  if (request.id) {
    const result = database
      .prepare(
        `UPDATE smart_collections
         SET name=?, normalized_name=?, criteria_json=?, updated_at_ms=? WHERE id=?`
      )
      .run(name, name.toLocaleLowerCase('en-US'), criteriaJson, timestamp, request.id)
    if (!result.changes) throw new Error('Smart Collection was not found.')
    return
  }
  database
    .prepare('INSERT INTO smart_collections VALUES (?,?,?,?,?,?)')
    .run(createId(), name, name.toLocaleLowerCase('en-US'), criteriaJson, timestamp, timestamp)
}

export function deleteSmartCollection(database: DatabaseSync, id: string): void {
  const result = database.prepare('DELETE FROM smart_collections WHERE id=?').run(id)
  if (!result.changes) throw new Error('Smart Collection was not found.')
}
