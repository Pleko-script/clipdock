import type { DatabaseSync } from 'node:sqlite'
import type { AssetFacetOption, AssetFacets, AssetQuery } from '../shared/clipdock'
import { expandSfxSearch } from '../shared/sfxSynonyms'
import { hasAssetSearchIndex } from './assetSearch'

const ASPECT_SQL = `CASE
  WHEN a.width_pixels IS NULL OR a.height_pixels IS NULL OR a.width_pixels <= 0 OR a.height_pixels <= 0 THEN 'unknown'
  WHEN ABS(a.width_pixels-a.height_pixels)*20 <= MAX(a.width_pixels,a.height_pixels) THEN 'square'
  WHEN a.width_pixels > a.height_pixels THEN 'landscape'
  ELSE 'portrait' END`

const DURATION_SQL = `CASE
  WHEN a.duration_ms IS NULL THEN 'unknown'
  WHEN a.duration_ms < 1000 THEN 'under-1s'
  WHEN a.duration_ms < 3000 THEN '1-3s'
  WHEN a.duration_ms < 10000 THEN '3-10s'
  ELSE 'over-10s' END`

const AUDIO_SQL = `CASE
  WHEN a.media_type='audio' OR a.audio_codec IS NOT NULL OR COALESCE(a.channels,0) > 0 THEN 'with-audio'
  ELSE 'silent' END`

const CODEC_SQL = `LOWER(COALESCE(NULLIF(a.codec,''),NULLIF(a.audio_codec,''),'unknown'))`
const UCS_VALUE_SQL = `LOWER(COALESCE(NULLIF(a.ucs_cat_id,''),NULLIF(a.ucs_category,''),''))`
const UCS_LABEL_SQL = `TRIM(COALESCE(a.ucs_cat_id,'') || CASE
  WHEN a.ucs_category IS NOT NULL OR a.ucs_subcategory IS NOT NULL THEN
    CASE WHEN a.ucs_cat_id IS NOT NULL THEN ' · ' ELSE '' END ||
    COALESCE(a.ucs_category,'') ||
    CASE WHEN a.ucs_category IS NOT NULL AND a.ucs_subcategory IS NOT NULL THEN '-' ELSE '' END ||
    COALESCE(a.ucs_subcategory,'')
  ELSE '' END)`

const FACET_KEYS: ReadonlyArray<keyof AssetFacets> = [
  'kinds',
  'packs',
  'categories',
  'aspects',
  'durations',
  'overlayModes',
  'audioStates',
  'ucsCategories',
  'formats',
  'codecs',
  'statuses',
  'previewStatuses'
]

export interface AssetWhereClause {
  whereSql: string
  params: Array<string | number>
}

export function buildAssetWhere(
  database: DatabaseSync,
  query: AssetQuery,
  excludedFacets?: keyof AssetFacets | ReadonlySet<keyof AssetFacets>
): AssetWhereClause {
  const where: string[] = []
  const params: Array<string | number> = []
  const addIn = (
    facet: keyof AssetFacets,
    column: string,
    values: readonly string[] | undefined
  ): void => {
    const excluded =
      facet === excludedFacets || (excludedFacets instanceof Set && excludedFacets.has(facet))
    if (excluded || !values?.length) return
    where.push(`${column} IN (${values.map(() => '?').join(',')})`)
    params.push(...values)
  }

  addIn('kinds', 'a.kind', query.kinds)
  addIn('packs', 'a.pack_id', query.packIds)
  addIn('categories', 'a.category_path', query.categoryPaths)
  const aspectsExcluded =
    excludedFacets === 'aspects' || (excludedFacets instanceof Set && excludedFacets.has('aspects'))
  if (!aspectsExcluded && query.aspects?.length) {
    where.push("a.media_type='video'")
    addIn('aspects', ASPECT_SQL, query.aspects)
  }
  addIn('durations', DURATION_SQL, query.durationBuckets)
  const overlayModesExcluded =
    excludedFacets === 'overlayModes' ||
    (excludedFacets instanceof Set && excludedFacets.has('overlayModes'))
  if (!overlayModesExcluded && query.overlayModes?.length) {
    where.push(`a.kind='overlay'`)
    addIn('overlayModes', 'a.overlay_mode', query.overlayModes)
  }
  addIn('audioStates', AUDIO_SQL, query.audioStates)
  addIn(
    'ucsCategories',
    UCS_VALUE_SQL,
    query.ucsCategories?.map((value) => value.toLocaleLowerCase('en-US'))
  )
  addIn(
    'formats',
    'a.extension',
    query.formats?.map((value) => value.toLocaleLowerCase('en-US'))
  )
  addIn(
    'codecs',
    CODEC_SQL,
    query.codecs?.map((value) => value.toLocaleLowerCase('en-US'))
  )
  addIn('statuses', 'a.status', query.statuses)
  addIn('previewStatuses', 'a.preview_status', query.previewStatuses)

  if (query.favoriteOnly) where.push('a.favorite = 1')
  if (query.usedOnly) where.push('a.last_used_at_ms IS NOT NULL')
  if (!query.includeHiddenDuplicates) where.push('a.duplicate_hidden = 0')
  if (query.duplicateOnly)
    where.push(
      `a.status='ready' AND a.content_hash IS NOT NULL AND EXISTS (
        SELECT 1 FROM assets duplicate
        WHERE duplicate.status='ready' AND duplicate.content_hash=a.content_hash AND duplicate.id!=a.id
      )`
    )
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
    params.push(
      ...query.tags.map((tag) => tag.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'))
    )
  }

  const search = query.search?.trim().toLocaleLowerCase('en-US')
  if (search) {
    const expanded = expandSfxSearch(search, query.exactSearch)
    if (hasAssetSearchIndex(database) && expanded.termGroups.length) {
      where.push(`a.id IN (SELECT asset_id FROM asset_search WHERE asset_search MATCH ?)`)
      params.push(
        expanded.termGroups
          .map((group) => {
            const terms = group.map((term) => `"${term.replaceAll('"', '""')}"*`)
            return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`
          })
          .join(' AND ')
      )
    } else {
      const fieldMatch = `(LOWER(a.display_name) LIKE ? OR LOWER(a.relative_path) LIKE ? OR LOWER(p.name) LIKE ? OR LOWER(a.note) LIKE ? OR LOWER(COALESCE(a.ucs_cat_id,'')) LIKE ? OR LOWER(COALESCE(a.ucs_category,'')) LIKE ? OR LOWER(COALESCE(a.ucs_subcategory,'')) LIKE ? OR EXISTS (SELECT 1 FROM asset_tags at JOIN tags t ON t.id=at.tag_id WHERE at.asset_id=a.id AND LOWER(t.name) LIKE ?))`
      where.push(
        expanded.termGroups
          .map((group) => `(${group.map(() => fieldMatch).join(' OR ')})`)
          .join(' AND ')
      )
      for (const group of expanded.termGroups) {
        for (const synonym of group) {
          const term = `%${synonym}%`
          params.push(term, term, term, term, term, term, term, term)
        }
      }
    }
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params
  }
}

export function queryAssetFacets(database: DatabaseSync, query: AssetQuery): AssetFacets {
  const selected: Record<keyof AssetFacets, ReadonlySet<string>> = {
    kinds: new Set(query.kinds),
    packs: new Set(query.packIds),
    categories: new Set(query.categoryPaths),
    aspects: new Set(query.aspects),
    durations: new Set(query.durationBuckets),
    overlayModes: new Set(query.overlayModes),
    audioStates: new Set(query.audioStates),
    ucsCategories: new Set(query.ucsCategories),
    formats: new Set(query.formats),
    codecs: new Set(query.codecs),
    statuses: new Set(query.statuses),
    previewStatuses: new Set(query.previewStatuses)
  }
  const activeFacets = FACET_KEYS.filter((facet) => selected[facet].size)
  const candidates = activeFacets.length
    ? activeFacets.map((facet) => buildAssetWhere(database, query, facet))
    : [buildAssetWhere(database, query, new Set(FACET_KEYS))]
  const whereSql = `WHERE ${candidates
    .map((candidate) => `(${candidate.whereSql ? candidate.whereSql.slice(6) : '1=1'})`)
    .join(' OR ')}`
  const params = candidates.flatMap((candidate) => candidate.params)
  const rows = database
    .prepare(
      `SELECT a.pack_id, p.name pack_name, a.category_path, a.kind, a.media_type,
              ${ASPECT_SQL} aspect, ${DURATION_SQL} duration_bucket,
              a.overlay_mode, ${AUDIO_SQL} audio_state, a.extension,
              ${UCS_VALUE_SQL} ucs_value, ${UCS_LABEL_SQL} ucs_label,
              ${CODEC_SQL} codec_value, a.status, a.preview_status
       FROM assets a JOIN asset_packs p ON p.id=a.pack_id ${whereSql}`
    )
    .all(...params) as Array<Record<string, string>>
  const buckets = Object.fromEntries(
    FACET_KEYS.map((key) => [key, new Map<string, AssetFacetOption>()])
  ) as Record<keyof AssetFacets, Map<string, AssetFacetOption>>
  const add = (facet: keyof AssetFacets, value: string, label = value): void => {
    const current = buckets[facet].get(value)
    if (current) current.count += 1
    else buckets[facet].set(value, { value, label, count: 1 })
  }

  const valueFor = (row: Record<string, string>, facet: keyof AssetFacets): string => {
    if (facet === 'kinds') return row.kind
    if (facet === 'packs') return row.pack_id
    if (facet === 'categories') return row.category_path
    if (facet === 'aspects') return row.aspect
    if (facet === 'durations') return row.duration_bucket
    if (facet === 'overlayModes') return row.overlay_mode
    if (facet === 'audioStates') return row.audio_state
    if (facet === 'ucsCategories') return row.ucs_value
    if (facet === 'formats') return row.extension
    if (facet === 'codecs') return row.codec_value
    if (facet === 'statuses') return row.status
    return row.preview_status
  }
  const eligible = (row: Record<string, string>, facet: keyof AssetFacets): boolean =>
    (facet !== 'aspects' || row.media_type === 'video') &&
    (facet !== 'overlayModes' || row.kind === 'overlay') &&
    (facet !== 'ucsCategories' || Boolean(row.ucs_value))
  for (const row of rows) {
    let failedMask = 0
    for (let index = 0; index < FACET_KEYS.length; index += 1) {
      const facet = FACET_KEYS[index]
      if (
        selected[facet].size &&
        (!eligible(row, facet) || !selected[facet].has(valueFor(row, facet)))
      )
        failedMask |= 1 << index
    }
    for (let index = 0; index < FACET_KEYS.length; index += 1) {
      const facet = FACET_KEYS[index]
      const otherFacetsMask = failedMask & ~(1 << index)
      if (!eligible(row, facet) || otherFacetsMask) continue
      add(
        facet,
        valueFor(row, facet),
        facet === 'packs'
          ? row.pack_name
          : facet === 'ucsCategories'
            ? row.ucs_label
            : valueFor(row, facet)
      )
    }
  }

  return Object.fromEntries(
    Object.entries(buckets).map(([key, values]) => [
      key,
      [...values.values()].sort((left, right) =>
        (left.label ?? left.value).localeCompare(right.label ?? right.value)
      )
    ])
  ) as unknown as AssetFacets
}
