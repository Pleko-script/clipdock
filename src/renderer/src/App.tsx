import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type MouseEvent
} from 'react'
import { Grid2X2, PanelTopOpen, RefreshCw, Search } from 'lucide-react'
import {
  assetFiltersToQuery,
  countAssetFilters,
  emptyAssetFilters,
  toggleAssetFilter
} from '../../shared/assetFilters'
import type {
  AssetFacets,
  AssetFilterField,
  AssetFilterSelection,
  AssetJobEvent,
  AssetKind,
  AssetLibraryScope,
  AssetNavigationSnapshot,
  AssetPosterRequest,
  AssetQuery,
  AssetSortMode,
  AssetSmartCollectionCriteria,
  AssetSmartCollectionSummary,
  AssetSummary,
  AssetTrimRequest,
  AssetUpdateRequest,
  ClipdockApi,
  ClipdockResult
} from '../../shared/clipdock'
import { expandSfxSearch } from '../../shared/sfxSynonyms'
import { AssetGrid } from './components/AssetGrid'
import { AssetFilterChips, AssetFilterPopover } from './components/AssetFilters'
import { AssetInspector } from './components/AssetInspector'
import { AssetSidebar } from './components/AssetSidebar'
import { ComparisonTray } from './components/ComparisonTray'
import { DuplicateReview } from './components/DuplicateReview'
import { QuickLook } from './components/QuickLook'
import {
  addComparisonCandidate,
  COMPARISON_SHORTLIST_LIMIT,
  removeComparisonCandidate
} from './comparisonShortlist'
import { useI18n } from './i18n'

const EMPTY_NAVIGATION: AssetNavigationSnapshot = {
  packs: [],
  collections: [],
  smartCollections: [],
  tags: [],
  totalAssets: 0,
  favoriteCount: 0,
  usedAssetCount: 0,
  duplicateAssetCount: 0,
  duplicateGroupCount: 0,
  pendingHashCount: 0,
  pendingPreviewCount: 0
}

const EMPTY_FACETS: AssetFacets = {
  kinds: [],
  packs: [],
  categories: [],
  aspects: [],
  durations: [],
  overlayModes: [],
  audioStates: [],
  ucsCategories: [],
  formats: [],
  codecs: [],
  statuses: [],
  previewStatuses: []
}

function scopeFilters(scope: AssetLibraryScope): Partial<AssetQuery> {
  if (scope.type === 'pack') return { packIds: [scope.id] }
  if (scope.type === 'collection') return { collectionIds: [scope.id] }
  if (scope.type === 'tag') return { tags: [scope.name] }
  if (scope.type === 'favorites') return { favoriteOnly: true }
  if (scope.type === 'recent') return { usedOnly: true }
  if (scope.type === 'duplicates') return { duplicateOnly: true, includeHiddenDuplicates: true }
  return {}
}

function scopeName(
  scope: AssetLibraryScope,
  navigation: AssetNavigationSnapshot,
  activeSmartCollectionId: string | null,
  t: ReturnType<typeof useI18n>['t']
): string {
  if (activeSmartCollectionId)
    return (
      navigation.smartCollections.find((collection) => collection.id === activeSmartCollectionId)
        ?.name ?? t('app.smartCollection')
    )
  if (scope.type === 'pack')
    return navigation.packs.find((pack) => pack.id === scope.id)?.name ?? t('app.pack')
  if (scope.type === 'collection')
    return (
      navigation.collections.find((collection) => collection.id === scope.id)?.name ??
      t('app.collection')
    )
  if (scope.type === 'tag') return `#${scope.name}`
  if (scope.type === 'favorites') return t('app.favorites')
  if (scope.type === 'duplicates') return t('app.duplicates')
  return scope.type === 'recent' ? t('app.recentlyUsed') : t('app.entireLibrary')
}

function App(): JSX.Element {
  const { error: localizeError, language, t } = useI18n()
  const [navigation, setNavigation] = useState(EMPTY_NAVIGATION)
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [exactSearch, setExactSearch] = useState(false)
  const [filters, setFilters] = useState<AssetFilterSelection>(emptyAssetFilters)
  const [facets, setFacets] = useState<AssetFacets>(EMPTY_FACETS)
  const [scope, setScope] = useState<AssetLibraryScope>({ type: 'all' })
  const [activeSmartCollectionId, setActiveSmartCollectionId] = useState<string | null>(null)
  const [sort, setSort] = useState<AssetSortMode>('name')
  const [density, setDensity] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [quickLookId, setQuickLookId] = useState<string | null>(null)
  const [comparisonAssets, setComparisonAssets] = useState<AssetSummary[]>([])
  const [comparisonActiveId, setComparisonActiveId] = useState<string | null>(null)
  const [comparisonCollapsed, setComparisonCollapsed] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [jobProgress, setJobProgress] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const lastSelectedIndex = useRef<number | null>(null)
  const nextCursorRef = useRef<string | null>(null)
  const assetRequestRef = useRef(0)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const kind: AssetKind | 'all' = filters.kinds.length === 1 ? filters.kinds[0] : 'all'

  const currentSmartCollectionCriteria = useMemo<AssetSmartCollectionCriteria>(
    () => ({ search, exactSearch, filters, scope, sort }),
    [exactSearch, filters, scope, search, sort]
  )
  const relatedSearch = useMemo(() => expandSfxSearch(search), [search])

  const showTransientStatus = useCallback((message: string): void => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    setStatus(message)
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = null
      setStatus(null)
    }, 4_000)
  }, [])

  const showPersistentStatus = useCallback((message: string | null): void => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = null
    setStatus(message)
  }, [])

  const query = useMemo<AssetQuery>(
    () => ({
      search: debouncedSearch || undefined,
      exactSearch,
      ...assetFiltersToQuery(filters),
      ...scopeFilters(scope),
      sort,
      limit: 200
    }),
    [debouncedSearch, exactSearch, filters, scope, sort]
  )

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedIds.has(asset.id)),
    [assets, selectedIds]
  )
  const activeAsset = assets.find((asset) => asset.id === activeId) ?? null
  const quickLookAsset = assets.find((asset) => asset.id === quickLookId) ?? null
  const comparisonIds = useMemo(
    () => new Set(comparisonAssets.map((asset) => asset.id)),
    [comparisonAssets]
  )

  const loadNavigation = useCallback(async (): Promise<void> => {
    const result = await window.clipdock.getNavigationSnapshot()
    if (result.ok) setNavigation(result.value)
    else showPersistentStatus(localizeError(result.error.message))
  }, [localizeError, showPersistentStatus])

  const loadAssets = useCallback(
    async (append = false, resetSelection = false): Promise<void> => {
      const requestId = ++assetRequestRef.current
      const result = await window.clipdock.queryAssets({
        ...query,
        cursor: append ? (nextCursorRef.current ?? undefined) : undefined
      })
      if (requestId !== assetRequestRef.current) return
      if (!result.ok) {
        showPersistentStatus(localizeError(result.error.message))
        return
      }
      setAssets((current) => (append ? [...current, ...result.value.items] : result.value.items))
      setNextCursor(result.value.nextCursor)
      nextCursorRef.current = result.value.nextCursor
      setTotalCount(result.value.totalCount)
      if (!append) setFacets(result.value.facets)
      if (!append) {
        if (resetSelection) {
          setSelectedIds(new Set())
          setActiveId(result.value.items[0]?.id ?? null)
          lastSelectedIndex.current = result.value.items.length ? 0 : null
        } else {
          const available = new Set(result.value.items.map((asset) => asset.id))
          setSelectedIds((current) => new Set([...current].filter((id) => available.has(id))))
          setActiveId((current) =>
            current && available.has(current) ? current : (result.value.items[0]?.id ?? null)
          )
        }
      }
    },
    [localizeError, query, showPersistentStatus]
  )

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([loadNavigation(), loadAssets(false, false)])
  }, [loadAssets, loadNavigation])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 150)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    queueMicrotask(() => showPersistentStatus(null))
  }, [language, showPersistentStatus])
  useEffect(
    () => () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    },
    []
  )
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) void loadAssets(false, true)
    })
    return () => {
      active = false
    }
  }, [loadAssets])
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) void loadNavigation()
    })
    return () => {
      active = false
    }
  }, [loadNavigation])

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = (): void => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => void refresh(), 150)
    }
    const offJobs = window.clipdock.onAssetJobEvent((event: AssetJobEvent) => {
      if (event.type === 'scan-progress')
        setJobProgress(
          t('app.scanningProgress', { current: event.completed + 1, total: event.total })
        )
      if (event.type === 'preview-progress')
        setJobProgress(t('app.previewProgress', { current: event.completed, total: event.total }))
      if (
        event.type === 'scan-completed' ||
        event.type === 'preview-completed' ||
        event.type === 'hash-completed'
      )
        scheduleRefresh()
      if (event.type === 'scan-completed') setJobProgress(null)
      if (event.type === 'preview-failed') showPersistentStatus(localizeError(event.message))
      if (event.type === 'hash-failed') showPersistentStatus(localizeError(event.message))
    })
    const offDrag = window.clipdock.onAssetDragEvent((event) => {
      const preparedCount = event.trimmedAssetIds?.length ?? 0
      const prepared = preparedCount ? t('app.preparedCount', { count: preparedCount }) : ''
      if (event.type === 'drag-started')
        showTransientStatus(
          t(event.assetIds.length === 1 ? 'app.draggedOne' : 'app.draggedMany', {
            count: event.assetIds.length,
            prepared
          })
        )
      else showPersistentStatus(localizeError(event.error?.message ?? t('app.dragFailed')))
      if (event.type === 'drag-started') scheduleRefresh()
    })
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      offJobs()
      offDrag()
    }
  }, [localizeError, refresh, showPersistentStatus, showTransientStatus, t])

  const mutate = useCallback(
    async (operation: (bridge: ClipdockApi) => Promise<ClipdockResult<unknown>>): Promise<void> => {
      const result = await operation(window.clipdock)
      if (!result.ok) showPersistentStatus(localizeError(result.error.message))
      else await refresh()
    },
    [localizeError, refresh, showPersistentStatus]
  )

  const addPack = async (): Promise<void> => {
    setBusy(true)
    showPersistentStatus(t('app.addingPack'))
    const result = await window.clipdock.addPackFolder()
    setBusy(false)
    if (result.ok)
      showTransientStatus(
        t(result.value.importedAssets === 1 ? 'app.importedOne' : 'app.importedMany', {
          count: result.value.importedAssets
        })
      )
    else showPersistentStatus(localizeError(result.error.message))
    if (result.ok) {
      const alreadyShowingAll = scope.type === 'all'
      setActiveSmartCollectionId(null)
      setScope({ type: 'all' })
      await loadNavigation()
      if (alreadyShowingAll) await loadAssets(false, false)
    }
  }

  const rescan = async (): Promise<void> => {
    setBusy(true)
    showPersistentStatus(t('app.scanningPacks'))
    const result = await window.clipdock.rescanPacks(scope.type === 'pack' ? [scope.id] : undefined)
    setBusy(false)
    setJobProgress(null)
    if (result.ok) showTransientStatus(t('app.scanComplete'))
    else showPersistentStatus(localizeError(result.error.message))
    if (result.ok) await refresh()
  }

  const updateAssets = (request: AssetUpdateRequest): void => {
    void mutate((bridge) => bridge.updateAssets(request))
  }

  const toggleFilter = useCallback((field: AssetFilterField, value: string): void => {
    setActiveSmartCollectionId(null)
    setFilters((current) => toggleAssetFilter(current, field, value))
  }, [])

  const clearFilters = useCallback((): void => {
    setActiveSmartCollectionId(null)
    setFilters(emptyAssetFilters())
  }, [])

  const clearEmptyFilters = useCallback((): void => {
    setSearch('')
    setDebouncedSearch('')
    setExactSearch(false)
    clearFilters()
  }, [clearFilters])

  const selectSmartCollection = useCallback((collection: AssetSmartCollectionSummary): void => {
    setSearch(collection.criteria.search)
    setDebouncedSearch(collection.criteria.search)
    setExactSearch(collection.criteria.exactSearch)
    setFilters(collection.criteria.filters)
    setScope(collection.criteria.scope)
    setSort(collection.criteria.sort)
    setActiveSmartCollectionId(collection.id)
  }, [])

  const setAssetTrim = useCallback(
    async (request: AssetTrimRequest): Promise<ClipdockResult<void>> => {
      const resetting =
        request.startMs === null && request.endMs === null && request.rotationDegrees === 0
      showPersistentStatus(t(resetting ? 'app.resettingEdit' : 'app.renderingEdit'))
      const result = await window.clipdock.setAssetTrim(request)
      if (result.ok) showTransientStatus(t(resetting ? 'app.editReset' : 'app.editReady'))
      else showPersistentStatus(localizeError(result.error.message))
      if (result.ok) await refresh()
      return result
    },
    [localizeError, refresh, showPersistentStatus, showTransientStatus, t]
  )

  const setAssetPoster = useCallback(
    async (request: AssetPosterRequest): Promise<ClipdockResult<void>> => {
      showPersistentStatus(t(request.frameMs === null ? 'app.resettingPoster' : 'app.savingPoster'))
      const result = await window.clipdock.setAssetPoster(request)
      if (result.ok)
        showTransientStatus(t(request.frameMs === null ? 'app.posterReset' : 'app.posterReady'))
      else showPersistentStatus(localizeError(result.error.message))
      if (result.ok) await refresh()
      return result
    },
    [localizeError, refresh, showPersistentStatus, showTransientStatus, t]
  )

  const selectAsset = (asset: AssetSummary, event: MouseEvent): void => {
    const index = assets.findIndex((item) => item.id === asset.id)
    setActiveId(asset.id)
    setSelectedIds((current) => {
      if (event.shiftKey && lastSelectedIndex.current !== null) {
        const start = Math.min(lastSelectedIndex.current, index)
        const end = Math.max(lastSelectedIndex.current, index)
        return new Set(assets.slice(start, end + 1).map((item) => item.id))
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(current)
        if (next.has(asset.id)) next.delete(asset.id)
        else next.add(asset.id)
        lastSelectedIndex.current = index
        return next
      }
      lastSelectedIndex.current = index
      return new Set([asset.id])
    })
  }

  const dragAsset = (asset: AssetSummary, event: DragEvent<HTMLElement>): void => {
    const ids = selectedIds.has(asset.id) ? [...selectedIds] : [asset.id]
    event.preventDefault()
    event.dataTransfer.setData('application/x-clipdock-asset-ids', JSON.stringify(ids))
    window.clipdock.startAssetDrag({ assetIds: ids })
  }

  const dragComparisonAsset = (asset: AssetSummary, event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    event.dataTransfer.setData('application/x-clipdock-asset-ids', JSON.stringify([asset.id]))
    window.clipdock.startAssetDrag({ assetIds: [asset.id] })
  }

  const removeComparisonAsset = (assetId: string): void => {
    const index = comparisonAssets.findIndex((asset) => asset.id === assetId)
    const remainingIds = removeComparisonCandidate(
      comparisonAssets.map((asset) => asset.id),
      assetId
    )
    const remaining = comparisonAssets.filter((asset) => remainingIds.includes(asset.id))
    setComparisonAssets(remaining)
    if (comparisonActiveId === assetId)
      setComparisonActiveId(
        remaining[Math.min(Math.max(0, index), remaining.length - 1)]?.id ?? null
      )
  }

  const toggleComparisonAsset = (asset: AssetSummary): void => {
    if (comparisonIds.has(asset.id)) {
      removeComparisonAsset(asset.id)
      return
    }
    const change = addComparisonCandidate(
      comparisonAssets.map((candidate) => candidate.id),
      asset.id
    )
    if (change.limitReached) {
      showTransientStatus(t('compare.limitReached'))
      return
    }
    setComparisonAssets((current) => [...current, asset])
    setComparisonActiveId((current) => current ?? asset.id)
    setComparisonCollapsed(false)
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      if (event.defaultPrevented) return
      const interactive = Boolean(
        target.closest('input, textarea, select, button, [role="slider"], [contenteditable="true"]')
      )
      if (event.key === '/' && !interactive) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'Escape') {
        setQuickLookId(null)
        return
      }
      if (interactive) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelectedIds(new Set(assets.map((asset) => asset.id)))
        return
      }
      if (event.key === ' ' && activeId) {
        event.preventDefault()
        setQuickLookId(activeId)
        return
      }
      if (event.key.toLowerCase() === 'f' && activeId) {
        event.preventDefault()
        void mutate((bridge) => bridge.toggleAssetFavorite(activeId))
        return
      }
      if (event.key === '+' || event.key === '=') {
        setDensity((value) => Math.min(3, value + 1))
        return
      }
      if (event.key === '-') {
        setDensity((value) => Math.max(0, value - 1))
        return
      }
      if (event.key.startsWith('Arrow') && assets.length) {
        event.preventDefault()
        const current = Math.max(
          0,
          assets.findIndex((asset) => asset.id === activeId)
        )
        const next =
          event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? Math.min(assets.length - 1, current + 1)
            : Math.max(0, current - 1)
        setActiveId(assets[next].id)
        setSelectedIds(new Set([assets[next].id]))
        lastSelectedIndex.current = next
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activeId, assets, mutate])

  return (
    <main className="asset-app">
      <AssetSidebar
        navigation={navigation}
        activePackId={scope.type === 'pack' ? scope.id : null}
        activeCollectionId={scope.type === 'collection' ? scope.id : null}
        activeSmartCollectionId={activeSmartCollectionId}
        selectedTag={scope.type === 'tag' ? scope.name : null}
        favoriteOnly={scope.type === 'favorites'}
        recentlyUsed={scope.type === 'recent'}
        duplicatesOnly={scope.type === 'duplicates'}
        busy={busy}
        onShowAll={() => {
          setActiveSmartCollectionId(null)
          setScope({ type: 'all' })
        }}
        onShowFavorites={() => {
          setActiveSmartCollectionId(null)
          setScope({ type: 'favorites' })
        }}
        onShowRecentlyUsed={() => {
          setActiveSmartCollectionId(null)
          setScope({ type: 'recent' })
          setSort('last-used')
        }}
        onShowDuplicates={() => {
          setActiveSmartCollectionId(null)
          setInspectorOpen(false)
          setScope({ type: 'duplicates' })
        }}
        onSelectPack={(id) => {
          setActiveSmartCollectionId(null)
          setFilters((current) => ({ ...current, packIds: [] }))
          setScope({ type: 'pack', id })
        }}
        onSelectCollection={(id) => {
          setActiveSmartCollectionId(null)
          setScope({ type: 'collection', id })
        }}
        onSelectSmartCollection={selectSmartCollection}
        onSelectTag={(name) => {
          setActiveSmartCollectionId(null)
          setScope({ type: 'tag', name })
        }}
        onAddPack={() => void addPack()}
        onRelinkPack={(id) => void mutate((bridge) => bridge.relinkPack(id))}
        onCreateCollection={() => {
          const name = window.prompt(t('dialog.collectionName'))
          if (name) void mutate((bridge) => bridge.createCollection(name))
        }}
        onCreateSmartCollection={() => {
          const name = window.prompt(t('dialog.smartCollectionName'))
          if (name)
            void mutate((bridge) =>
              bridge.saveSmartCollection({ name, criteria: currentSmartCollectionCriteria })
            )
        }}
        onRenameCollection={(id, currentName) => {
          const name = window.prompt(t('dialog.collectionName'), currentName)
          if (name && name !== currentName)
            void mutate((bridge) => bridge.renameCollection(id, name))
        }}
        onDeleteCollection={(id, name) => {
          if (window.confirm(t('dialog.deleteCollection', { name })))
            void mutate((bridge) => bridge.deleteCollection(id))
        }}
        onRenameSmartCollection={(collection) => {
          const name = window.prompt(t('dialog.smartCollectionName'), collection.name)
          if (name && name !== collection.name)
            void mutate((bridge) =>
              bridge.saveSmartCollection({
                id: collection.id,
                name,
                criteria: collection.criteria
              })
            )
        }}
        onUpdateSmartCollection={(collection) =>
          void mutate((bridge) =>
            bridge.saveSmartCollection({
              id: collection.id,
              name: collection.name,
              criteria: currentSmartCollectionCriteria
            })
          )
        }
        onDeleteSmartCollection={(collection) => {
          if (!window.confirm(t('dialog.deleteSmartCollection', { name: collection.name }))) return
          if (activeSmartCollectionId === collection.id) setActiveSmartCollectionId(null)
          void mutate((bridge) => bridge.deleteSmartCollection(collection.id))
        }}
        onDropCollection={(ids, collectionId) =>
          ids.length && void mutate((bridge) => bridge.addAssetsToCollection(ids, collectionId))
        }
      />

      <section className="asset-library">
        <header className="asset-toolbar">
          <div className="asset-search-control">
            <label className="asset-search">
              <Search size={18} />
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => {
                  setActiveSmartCollectionId(null)
                  setSearch(event.target.value)
                }}
                placeholder={t('toolbar.search')}
              />
              <kbd>/</kbd>
            </label>
            {relatedSearch.expanded ? (
              <button
                type="button"
                className={`search-mode ${exactSearch ? '' : 'active'}`}
                aria-pressed={!exactSearch}
                title={t('toolbar.relatedTerms', {
                  terms: relatedSearch.relatedTerms.slice(0, 5).join(', ')
                })}
                onClick={() => {
                  setActiveSmartCollectionId(null)
                  setExactSearch((current) => !current)
                }}
              >
                {exactSearch ? t('toolbar.exact') : t('toolbar.related')}
              </button>
            ) : null}
          </div>
          <nav className="kind-tabs">
            {(['all', 'transition', 'overlay', 'sound'] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={kind === value ? 'active' : ''}
                onClick={() => {
                  setActiveSmartCollectionId(null)
                  setFilters((current) => ({
                    ...current,
                    kinds: value === 'all' ? [] : [value]
                  }))
                }}
              >
                {value === 'all'
                  ? t('toolbar.all')
                  : value === 'transition'
                    ? t('toolbar.transitions')
                    : value === 'overlay'
                      ? t('toolbar.overlays')
                      : t('toolbar.sounds')}
              </button>
            ))}
          </nav>
          <div className="toolbar-actions">
            <AssetFilterPopover
              facets={facets}
              filters={filters}
              onToggle={toggleFilter}
              onClear={clearFilters}
            />
            <select
              value={sort}
              onChange={(event) => {
                setActiveSmartCollectionId(null)
                setSort(event.target.value as AssetSortMode)
              }}
              aria-label={t('toolbar.sort')}
            >
              <option value="name">{t('toolbar.name')}</option>
              <option value="last-used">{t('toolbar.lastUsed')}</option>
              <option value="most-used">{t('toolbar.mostUsed')}</option>
              <option value="modified">{t('toolbar.modified')}</option>
              <option value="duration">{t('toolbar.duration')}</option>
            </select>
            <Grid2X2 className="density-icon" size={15} aria-hidden="true" />
            <input
              className="density-range"
              type="range"
              min="0"
              max="3"
              value={density}
              onChange={(event) => setDensity(Number(event.target.value))}
              aria-label={t('toolbar.thumbnailSize')}
            />
            <button
              type="button"
              className={inspectorOpen ? 'active' : ''}
              title={t('toolbar.videoEditor')}
              aria-label={t('toolbar.toggleEditor')}
              onClick={() => setInspectorOpen((value) => !value)}
            >
              <PanelTopOpen size={17} />
            </button>
            <button
              type="button"
              title={t('toolbar.rescan')}
              aria-label={t('toolbar.rescan')}
              onClick={() => void rescan()}
              disabled={busy}
            >
              <RefreshCw size={17} className={busy ? 'spin' : ''} />
            </button>
          </div>
        </header>

        <AssetFilterChips
          facets={facets}
          filters={filters}
          onToggle={toggleFilter}
          onClear={clearFilters}
        />

        {inspectorOpen ? (
          <AssetInspector
            key={(selectedAssets.length ? selectedAssets : activeAsset ? [activeAsset] : [])
              .map(
                (asset) =>
                  `${asset.id}:${asset.trimStartMs}:${asset.trimEndMs}:${asset.rotationDegrees}:${asset.trimStatus}:${asset.posterFrameMs}`
              )
              .join(':')}
            assets={selectedAssets.length ? selectedAssets : activeAsset ? [activeAsset] : []}
            onClose={() => setInspectorOpen(false)}
            onUpdate={updateAssets}
            onSetTrim={setAssetTrim}
            onSetPoster={setAssetPoster}
            onReveal={(asset) => void mutate((bridge) => bridge.revealAsset(asset.id))}
            onRegenerate={(items) =>
              void mutate((bridge) => bridge.regeneratePreviews(items.map((item) => item.id)))
            }
            onRelink={(asset) => void mutate((bridge) => bridge.relinkPack(asset.packId))}
          />
        ) : null}

        <div className="asset-results-bar">
          <span>
            {t(totalCount === 1 ? 'results.oneAsset' : 'results.manyAssets', {
              count: totalCount
            })}
          </span>
          {selectedIds.size ? (
            <strong>
              {t(selectedIds.size === 1 ? 'results.oneSelected' : 'results.manySelected', {
                count: selectedIds.size
              })}
            </strong>
          ) : null}
          <span>{scopeName(scope, navigation, activeSmartCollectionId, t)}</span>
        </div>

        {scope.type === 'duplicates' ? (
          <DuplicateReview
            assets={assets}
            activeId={activeId}
            onSelect={(asset) => {
              setActiveId(asset.id)
              setSelectedIds(new Set([asset.id]))
            }}
            onOpen={(asset) => setQuickLookId(asset.id)}
            onDrag={dragAsset}
            onReveal={(asset) => void mutate((bridge) => bridge.revealAsset(asset.id))}
            onSetHidden={(asset, hidden) =>
              void mutate((bridge) =>
                bridge.setDuplicateVisibility({ assetIds: [asset.id], hidden })
              )
            }
          />
        ) : (
          <AssetGrid
            assets={assets}
            selectedIds={selectedIds}
            activeId={activeId}
            density={density}
            onSelect={selectAsset}
            onOpen={(asset) => setQuickLookId(asset.id)}
            onDrag={dragAsset}
            onFavorite={(asset) => void mutate((bridge) => bridge.toggleAssetFavorite(asset.id))}
            onRelink={(asset) => void mutate((bridge) => bridge.relinkPack(asset.packId))}
            onRetryPreview={(asset) =>
              void mutate((bridge) => bridge.regeneratePreviews([asset.id]))
            }
            comparisonIds={comparisonIds}
            comparisonLimitReached={comparisonAssets.length >= COMPARISON_SHORTLIST_LIMIT}
            onToggleComparison={toggleComparisonAsset}
            filteredEmpty={
              Boolean(search.trim()) ||
              countAssetFilters(filters) > 0 ||
              activeSmartCollectionId !== null
            }
            onClearFilters={clearEmptyFilters}
          />
        )}
        {comparisonAssets.length > 0 && comparisonActiveId ? (
          <ComparisonTray
            assets={comparisonAssets}
            activeId={comparisonActiveId}
            collapsed={comparisonCollapsed}
            onActiveChange={setComparisonActiveId}
            onRemove={removeComparisonAsset}
            onClear={() => {
              setComparisonAssets([])
              setComparisonActiveId(null)
            }}
            onCollapsedChange={setComparisonCollapsed}
            onDrag={dragComparisonAsset}
          />
        ) : null}
        {nextCursor ? (
          <button type="button" className="load-more" onClick={() => void loadAssets(true)}>
            {t('results.loadMore')}
          </button>
        ) : null}
        <footer className="asset-status">
          <span>{jobProgress ?? status ?? t('app.ready')}</span>
          <span>
            {navigation.pendingHashCount
              ? t('results.hashesPending', { count: navigation.pendingHashCount })
              : navigation.pendingPreviewCount
                ? t(
                    navigation.pendingPreviewCount === 1
                      ? 'results.previewsOne'
                      : 'results.previewsMany',
                    { count: navigation.pendingPreviewCount }
                  )
                : t('results.cacheReady')}
          </span>
        </footer>
      </section>

      {quickLookAsset ? (
        <QuickLook
          key={quickLookAsset.id}
          asset={quickLookAsset}
          onClose={() => setQuickLookId(null)}
          onFavorite={() => void mutate((bridge) => bridge.toggleAssetFavorite(quickLookAsset.id))}
        />
      ) : null}
    </main>
  )
}

export default App
