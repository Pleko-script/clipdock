import type {
  AssetFilterField,
  AssetFilterSelection,
  AssetQuery,
  AssetSmartCollectionCriteria
} from './clipdock'

export function emptyAssetFilters(): AssetFilterSelection {
  return {
    kinds: [],
    packIds: [],
    categoryPaths: [],
    aspects: [],
    durationBuckets: [],
    overlayModes: [],
    audioStates: [],
    ucsCategories: [],
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

export function assetFiltersFromQuery(query: AssetQuery): AssetFilterSelection {
  return {
    kinds: [...(query.kinds ?? [])],
    packIds: [...(query.packIds ?? [])],
    categoryPaths: [...(query.categoryPaths ?? [])],
    aspects: [...(query.aspects ?? [])],
    durationBuckets: [...(query.durationBuckets ?? [])],
    overlayModes: [...(query.overlayModes ?? [])],
    audioStates: [...(query.audioStates ?? [])],
    ucsCategories: [...(query.ucsCategories ?? [])],
    formats: [...(query.formats ?? [])],
    codecs: [...(query.codecs ?? [])],
    statuses: [...(query.statuses ?? [])],
    previewStatuses: [...(query.previewStatuses ?? [])]
  }
}

export function smartCollectionCriteriaToQuery(criteria: AssetSmartCollectionCriteria): AssetQuery {
  const scopeQuery: Partial<AssetQuery> =
    criteria.scope.type === 'pack'
      ? { packIds: [criteria.scope.id] }
      : criteria.scope.type === 'collection'
        ? { collectionIds: [criteria.scope.id] }
        : criteria.scope.type === 'tag'
          ? { tags: [criteria.scope.name] }
          : criteria.scope.type === 'favorites'
            ? { favoriteOnly: true }
            : criteria.scope.type === 'recent'
              ? { usedOnly: true }
              : {}
  return {
    search: criteria.search || undefined,
    exactSearch: criteria.exactSearch,
    ...assetFiltersToQuery(criteria.filters),
    ...scopeQuery,
    sort: criteria.sort,
    limit: 200
  }
}
