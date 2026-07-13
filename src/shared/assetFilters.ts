import type { AssetFilterField, AssetFilterSelection, AssetQuery } from './clipdock'

export function emptyAssetFilters(): AssetFilterSelection {
  return {
    kinds: [],
    packIds: [],
    categoryPaths: [],
    aspects: [],
    durationBuckets: [],
    overlayModes: [],
    audioStates: [],
    formats: [],
    codecs: [],
    statuses: [],
    previewStatuses: []
  }
}

export function toggleAssetFilter(
  filters: AssetFilterSelection,
  field: AssetFilterField,
  value: string
): AssetFilterSelection {
  const current = filters[field] as string[]
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]
  return { ...filters, [field]: next }
}

export function countAssetFilters(filters: AssetFilterSelection): number {
  return Object.values(filters).reduce((total, values) => total + values.length, 0)
}

export function assetFiltersToQuery(filters: AssetFilterSelection): Partial<AssetQuery> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, values]) => values.length > 0)
  ) as Partial<AssetQuery>
}
