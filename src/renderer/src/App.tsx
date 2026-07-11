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
import type {
  AssetJobEvent,
  AssetKind,
  AssetNavigationSnapshot,
  AssetQuery,
  AssetSortMode,
  AssetSummary,
  AssetTrimRequest,
  AssetUpdateRequest,
  ClipdockApi,
  ClipdockResult
} from '../../shared/clipdock'
import { AssetGrid } from './components/AssetGrid'
import { AssetInspector } from './components/AssetInspector'
import { AssetSidebar } from './components/AssetSidebar'
import { QuickLook } from './components/QuickLook'
import { useI18n } from './i18n'

const EMPTY_NAVIGATION: AssetNavigationSnapshot = {
  packs: [],
  collections: [],
  tags: [],
  totalAssets: 0,
  favoriteCount: 0,
  pendingPreviewCount: 0
}

type LibraryScope =
  | { type: 'all' }
  | { type: 'favorites' }
  | { type: 'pack'; id: string }
  | { type: 'collection'; id: string }
  | { type: 'tag'; name: string }

function scopeFilters(scope: LibraryScope): Partial<AssetQuery> {
  if (scope.type === 'pack') return { packIds: [scope.id] }
  if (scope.type === 'collection') return { collectionIds: [scope.id] }
  if (scope.type === 'tag') return { tags: [scope.name] }
  if (scope.type === 'favorites') return { favoriteOnly: true }
  return {}
}

function scopeName(
  scope: LibraryScope,
  navigation: AssetNavigationSnapshot,
  t: ReturnType<typeof useI18n>['t']
): string {
  if (scope.type === 'pack')
    return navigation.packs.find((pack) => pack.id === scope.id)?.name ?? t('app.pack')
  if (scope.type === 'collection')
    return (
      navigation.collections.find((collection) => collection.id === scope.id)?.name ??
      t('app.collection')
    )
  if (scope.type === 'tag') return `#${scope.name}`
  return scope.type === 'favorites' ? t('app.favorites') : t('app.entireLibrary')
}

function App(): JSX.Element {
  const { error: localizeError, language, t } = useI18n()
  const [navigation, setNavigation] = useState(EMPTY_NAVIGATION)
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [kind, setKind] = useState<AssetKind | 'all'>('all')
  const [scope, setScope] = useState<LibraryScope>({ type: 'all' })
  const [sort, setSort] = useState<AssetSortMode>('name')
  const [density, setDensity] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [quickLookId, setQuickLookId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [jobProgress, setJobProgress] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const lastSelectedIndex = useRef<number | null>(null)
  const nextCursorRef = useRef<string | null>(null)
  const assetRequestRef = useRef(0)

  const query = useMemo<AssetQuery>(
    () => ({
      search: debouncedSearch || undefined,
      kinds: kind === 'all' ? undefined : [kind],
      ...scopeFilters(scope),
      sort,
      limit: 200
    }),
    [debouncedSearch, kind, scope, sort]
  )

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedIds.has(asset.id)),
    [assets, selectedIds]
  )
  const activeAsset = assets.find((asset) => asset.id === activeId) ?? null
  const quickLookAsset = assets.find((asset) => asset.id === quickLookId) ?? null

  const loadNavigation = useCallback(async (): Promise<void> => {
    const result = await window.clipdock.getNavigationSnapshot()
    if (result.ok) setNavigation(result.value)
    else setStatus(localizeError(result.error.message))
  }, [localizeError])

  const loadAssets = useCallback(
    async (append = false, resetSelection = false): Promise<void> => {
      const requestId = ++assetRequestRef.current
      const result = await window.clipdock.queryAssets({
        ...query,
        cursor: append ? (nextCursorRef.current ?? undefined) : undefined
      })
      if (requestId !== assetRequestRef.current) return
      if (!result.ok) {
        setStatus(localizeError(result.error.message))
        return
      }
      setAssets((current) => (append ? [...current, ...result.value.items] : result.value.items))
      setNextCursor(result.value.nextCursor)
      nextCursorRef.current = result.value.nextCursor
      setTotalCount(result.value.totalCount)
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
    [localizeError, query]
  )

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([loadNavigation(), loadAssets(false, false)])
  }, [loadAssets, loadNavigation])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 150)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    queueMicrotask(() => setStatus(null))
  }, [language])
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
      if (event.type === 'scan-completed' || event.type === 'preview-completed') scheduleRefresh()
      if (event.type === 'scan-completed') setJobProgress(null)
      if (event.type === 'preview-failed') setStatus(localizeError(event.message))
    })
    const offDrag = window.clipdock.onAssetDragEvent((event) => {
      const preparedCount = event.trimmedAssetIds?.length ?? 0
      const prepared = preparedCount ? t('app.preparedCount', { count: preparedCount }) : ''
      setStatus(
        event.type === 'drag-started'
          ? t(event.assetIds.length === 1 ? 'app.draggedOne' : 'app.draggedMany', {
              count: event.assetIds.length,
              prepared
            })
          : localizeError(event.error?.message ?? t('app.dragFailed'))
      )
    })
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      offJobs()
      offDrag()
    }
  }, [localizeError, refresh, t])

  const mutate = useCallback(
    async (operation: (bridge: ClipdockApi) => Promise<ClipdockResult<unknown>>): Promise<void> => {
      const result = await operation(window.clipdock)
      if (!result.ok) setStatus(localizeError(result.error.message))
      else await refresh()
    },
    [localizeError, refresh]
  )

  const addPack = async (): Promise<void> => {
    setBusy(true)
    setStatus(t('app.addingPack'))
    const result = await window.clipdock.addPackFolder()
    setBusy(false)
    setStatus(
      result.ok
        ? t(result.value.importedAssets === 1 ? 'app.importedOne' : 'app.importedMany', {
            count: result.value.importedAssets
          })
        : localizeError(result.error.message)
    )
    if (result.ok) {
      const alreadyShowingAll = scope.type === 'all'
      setScope({ type: 'all' })
      await loadNavigation()
      if (alreadyShowingAll) await loadAssets(false, false)
    }
  }

  const rescan = async (): Promise<void> => {
    setBusy(true)
    setStatus(t('app.scanningPacks'))
    const result = await window.clipdock.rescanPacks(scope.type === 'pack' ? [scope.id] : undefined)
    setBusy(false)
    setJobProgress(null)
    setStatus(result.ok ? t('app.scanComplete') : localizeError(result.error.message))
    if (result.ok) await refresh()
  }

  const updateAssets = (request: AssetUpdateRequest): void => {
    void mutate((bridge) => bridge.updateAssets(request))
  }

  const setAssetTrim = useCallback(
    async (request: AssetTrimRequest): Promise<ClipdockResult<void>> => {
      const resetting =
        request.startMs === null && request.endMs === null && request.rotationDegrees === 0
      setStatus(t(resetting ? 'app.resettingEdit' : 'app.renderingEdit'))
      const result = await window.clipdock.setAssetTrim(request)
      setStatus(
        result.ok
          ? t(resetting ? 'app.editReset' : 'app.editReady')
          : localizeError(result.error.message)
      )
      if (result.ok) await refresh()
      return result
    },
    [localizeError, refresh, t]
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
        selectedTag={scope.type === 'tag' ? scope.name : null}
        favoriteOnly={scope.type === 'favorites'}
        busy={busy}
        onShowAll={() => setScope({ type: 'all' })}
        onShowFavorites={() => setScope({ type: 'favorites' })}
        onSelectPack={(id) => setScope({ type: 'pack', id })}
        onSelectCollection={(id) => setScope({ type: 'collection', id })}
        onSelectTag={(name) => setScope({ type: 'tag', name })}
        onAddPack={() => void addPack()}
        onRelinkPack={(id) => void mutate((bridge) => bridge.relinkPack(id))}
        onCreateCollection={() => {
          const name = window.prompt(t('dialog.collectionName'))
          if (name) void mutate((bridge) => bridge.createCollection(name))
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
        onDropCollection={(ids, collectionId) =>
          ids.length && void mutate((bridge) => bridge.addAssetsToCollection(ids, collectionId))
        }
      />

      <section className="asset-library">
        <header className="asset-toolbar">
          <label className="asset-search">
            <Search size={18} />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('toolbar.search')}
            />
            <kbd>/</kbd>
          </label>
          <nav className="kind-tabs">
            {(['all', 'transition', 'overlay', 'sound'] as const).map((value) => (
              <button
                type="button"
                key={value}
                className={kind === value ? 'active' : ''}
                onClick={() => setKind(value)}
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
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as AssetSortMode)}
              aria-label={t('toolbar.sort')}
            >
              <option value="name">{t('toolbar.name')}</option>
              <option value="recent">{t('toolbar.recent')}</option>
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

        {inspectorOpen ? (
          <AssetInspector
            key={(selectedAssets.length ? selectedAssets : activeAsset ? [activeAsset] : [])
              .map(
                (asset) =>
                  `${asset.id}:${asset.trimStartMs}:${asset.trimEndMs}:${asset.rotationDegrees}:${asset.trimStatus}`
              )
              .join(':')}
            assets={selectedAssets.length ? selectedAssets : activeAsset ? [activeAsset] : []}
            onClose={() => setInspectorOpen(false)}
            onUpdate={updateAssets}
            onSetTrim={setAssetTrim}
            onReveal={(asset) => void mutate((bridge) => bridge.revealAsset(asset.id))}
            onRegenerate={(items) =>
              void mutate((bridge) => bridge.regeneratePreviews(items.map((item) => item.id)))
            }
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
          <span>{scopeName(scope, navigation, t)}</span>
        </div>

        <AssetGrid
          assets={assets}
          selectedIds={selectedIds}
          activeId={activeId}
          density={density}
          onSelect={selectAsset}
          onOpen={(asset) => setQuickLookId(asset.id)}
          onDrag={dragAsset}
          onFavorite={(asset) => void mutate((bridge) => bridge.toggleAssetFavorite(asset.id))}
        />
        {nextCursor ? (
          <button type="button" className="load-more" onClick={() => void loadAssets(true)}>
            {t('results.loadMore')}
          </button>
        ) : null}
        <footer className="asset-status">
          <span>{jobProgress ?? status ?? t('app.ready')}</span>
          <span>
            {navigation.pendingPreviewCount
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
