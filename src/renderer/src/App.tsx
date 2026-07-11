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
import { Filter, Grid2X2, PanelRight, RefreshCw, Search } from 'lucide-react'
import type {
  AssetJobEvent,
  AssetKind,
  AssetNavigationSnapshot,
  AssetQuery,
  AssetSummary,
  AssetUpdateRequest,
  ClipdockApi
} from '../../shared/clipdock'
import { AssetGrid } from './components/AssetGrid'
import { AssetInspector } from './components/AssetInspector'
import { AssetSidebar } from './components/AssetSidebar'
import { QuickLook } from './components/QuickLook'

const EMPTY_NAVIGATION: AssetNavigationSnapshot = {
  packs: [],
  collections: [],
  tags: [],
  totalAssets: 0,
  favoriteCount: 0,
  pendingPreviewCount: 0
}

function api(): ClipdockApi | null {
  return window.clipdock ?? null
}

function App(): JSX.Element {
  const [navigation, setNavigation] = useState(EMPTY_NAVIGATION)
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [kind, setKind] = useState<AssetKind | 'all'>('all')
  const [activePackId, setActivePackId] = useState<string | null>(null)
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [sort, setSort] = useState<AssetQuery['sort']>('name')
  const [density, setDensity] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [quickLookId, setQuickLookId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [jobProgress, setJobProgress] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const lastSelectedIndex = useRef<number | null>(null)
  const nextCursorRef = useRef<string | null>(null)

  const query = useMemo<AssetQuery>(
    () => ({
      search: debouncedSearch || undefined,
      kinds: kind === 'all' ? undefined : [kind],
      packIds: activePackId ? [activePackId] : undefined,
      collectionIds: activeCollectionId ? [activeCollectionId] : undefined,
      tags: selectedTag ? [selectedTag] : undefined,
      favoriteOnly,
      sort,
      limit: 200
    }),
    [debouncedSearch, kind, activePackId, activeCollectionId, selectedTag, favoriteOnly, sort]
  )

  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedIds.has(asset.id)),
    [assets, selectedIds]
  )
  const activeAsset = assets.find((asset) => asset.id === activeId) ?? null
  const quickLookAsset = assets.find((asset) => asset.id === quickLookId) ?? null

  const loadNavigation = useCallback(async (): Promise<void> => {
    const bridge = api()
    if (!bridge) return
    const result = await bridge.getNavigationSnapshot()
    if (result.ok) setNavigation(result.value)
    else setStatus(result.error.message)
  }, [])

  const loadAssets = useCallback(
    async (append = false): Promise<void> => {
      const bridge = api()
      if (!bridge) {
        setStatus('Secure preload bridge unavailable.')
        return
      }
      const result = await bridge.queryAssets({
        ...query,
        cursor: append ? (nextCursorRef.current ?? undefined) : undefined
      })
      if (!result.ok) {
        setStatus(result.error.message)
        return
      }
      setAssets((current) => (append ? [...current, ...result.value.items] : result.value.items))
      setNextCursor(result.value.nextCursor)
      nextCursorRef.current = result.value.nextCursor
      setTotalCount(result.value.totalCount)
      if (!append) {
        setSelectedIds(new Set())
        setActiveId(result.value.items[0]?.id ?? null)
      }
    },
    [query]
  )

  const refresh = useCallback(async (): Promise<void> => {
    await Promise.all([loadNavigation(), loadAssets(false)])
  }, [loadAssets, loadNavigation])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 150)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const timer = setTimeout(() => void loadAssets(false), 0)
    return () => clearTimeout(timer)
  }, [loadAssets])
  useEffect(() => {
    const timer = setTimeout(() => void loadNavigation(), 0)
    return () => clearTimeout(timer)
  }, [loadNavigation])

  useEffect(() => {
    const bridge = api()
    if (!bridge) return
    const offJobs = bridge.onAssetJobEvent((event: AssetJobEvent) => {
      if (event.type === 'scan-progress')
        setJobProgress(`Scanning ${event.completed + 1} / ${event.total}`)
      if (event.type === 'preview-progress')
        setJobProgress(`Building previews ${event.completed} / ${event.total}`)
      if (event.type === 'scan-completed' || event.type === 'preview-completed') void refresh()
      if (event.type === 'scan-completed') setJobProgress(null)
      if (event.type === 'preview-failed') setStatus(event.message)
    })
    const offDrag = bridge.onAssetDragEvent((event) => {
      setStatus(
        event.type === 'drag-started'
          ? `Dragged ${event.assetIds.length} asset${event.assetIds.length === 1 ? '' : 's'}.`
          : (event.error?.message ?? 'Native drag failed.')
      )
    })
    return () => {
      offJobs()
      offDrag()
    }
  }, [refresh])

  const clearScope = (): void => {
    setActivePackId(null)
    setActiveCollectionId(null)
    setSelectedTag(null)
    setFavoriteOnly(false)
  }

  const mutate = useCallback(
    async (
      operation: (bridge: ClipdockApi) => Promise<{ ok: boolean; error?: { message: string } }>
    ): Promise<void> => {
      const bridge = api()
      if (!bridge) return
      const result = await operation(bridge)
      if (!result.ok) setStatus(result.error?.message ?? 'Operation failed.')
      else await refresh()
    },
    [refresh]
  )

  const addPack = async (): Promise<void> => {
    const bridge = api()
    if (!bridge) return
    setBusy(true)
    setStatus('Adding effect pack...')
    const result = await bridge.addPackFolder()
    setBusy(false)
    setStatus(
      result.ok ? `Imported ${result.value.importedAssets} new assets.` : result.error.message
    )
    if (result.ok) {
      clearScope()
      await refresh()
    }
  }

  const rescan = async (): Promise<void> => {
    const bridge = api()
    if (!bridge) return
    setBusy(true)
    setStatus('Scanning packs...')
    const result = await bridge.rescanPacks(activePackId ? [activePackId] : undefined)
    setBusy(false)
    setJobProgress(null)
    setStatus(result.ok ? 'Pack scan complete.' : result.error.message)
    if (result.ok) await refresh()
  }

  const updateAssets = (request: AssetUpdateRequest): void => {
    void mutate((bridge) => bridge.updateAssets(request))
  }

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
    const bridge = api()
    if (!bridge) return
    const ids = selectedIds.has(asset.id) ? [...selectedIds] : [asset.id]
    event.preventDefault()
    event.dataTransfer.setData('application/x-clipdock-asset-ids', JSON.stringify(ids))
    bridge.startAssetDrag({ assetIds: ids })
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (event.key === '/' && !editing) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'Escape') {
        setQuickLookId(null)
        return
      }
      if (editing) return
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
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [activeId, assets, mutate])

  return (
    <main className={`asset-app${inspectorOpen ? ' inspector-visible' : ''}`}>
      <AssetSidebar
        navigation={navigation}
        activePackId={activePackId}
        activeCollectionId={activeCollectionId}
        selectedTag={selectedTag}
        favoriteOnly={favoriteOnly}
        busy={busy}
        onShowAll={() => clearScope()}
        onShowFavorites={() => {
          clearScope()
          setFavoriteOnly(true)
        }}
        onSelectPack={(id) => {
          clearScope()
          setActivePackId(id)
        }}
        onSelectCollection={(id) => {
          clearScope()
          setActiveCollectionId(id)
        }}
        onSelectTag={(tag) => {
          clearScope()
          setSelectedTag(tag)
        }}
        onAddPack={() => void addPack()}
        onRelinkPack={(id) => void mutate((bridge) => bridge.relinkPack(id))}
        onCreateCollection={() => {
          const name = window.prompt('Collection name')
          if (name) void mutate((bridge) => bridge.createCollection(name))
        }}
        onRenameCollection={(id, currentName) => {
          const name = window.prompt('Collection name', currentName)
          if (name && name !== currentName)
            void mutate((bridge) => bridge.renameCollection(id, name))
        }}
        onDeleteCollection={(id, name) => {
          if (window.confirm(`Delete collection “${name}”? Assets stay in the library.`))
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
              placeholder="Search effects, packs, folders, tags"
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
                {value === 'all' ? 'All' : `${value[0].toUpperCase()}${value.slice(1)}s`}
              </button>
            ))}
          </nav>
          <div className="toolbar-actions">
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as AssetQuery['sort'])}
              aria-label="Sort assets"
            >
              <option value="name">Name</option>
              <option value="recent">Recently added</option>
              <option value="modified">Modified</option>
              <option value="duration">Duration</option>
            </select>
            <button
              type="button"
              title="Decrease thumbnail size"
              onClick={() => setDensity((value) => Math.max(0, value - 1))}
            >
              <Grid2X2 size={16} />
            </button>
            <input
              className="density-range"
              type="range"
              min="0"
              max="3"
              value={density}
              onChange={(event) => setDensity(Number(event.target.value))}
              aria-label="Thumbnail size"
            />
            <button type="button" title="Filters">
              <Filter size={17} />
            </button>
            <button
              type="button"
              className={inspectorOpen ? 'active' : ''}
              title="Inspector"
              onClick={() => setInspectorOpen((value) => !value)}
            >
              <PanelRight size={17} />
            </button>
            <button
              type="button"
              title="Rescan packs"
              onClick={() => void rescan()}
              disabled={busy}
            >
              <RefreshCw size={17} className={busy ? 'spin' : ''} />
            </button>
          </div>
        </header>

        <div className="asset-results-bar">
          <span>
            {totalCount} asset{totalCount === 1 ? '' : 's'}
          </span>
          {selectedIds.size ? <strong>{selectedIds.size} selected</strong> : null}
          <span>
            {activePackId
              ? navigation.packs.find((pack) => pack.id === activePackId)?.name
              : activeCollectionId
                ? navigation.collections.find((collection) => collection.id === activeCollectionId)
                    ?.name
                : selectedTag
                  ? `#${selectedTag}`
                  : favoriteOnly
                    ? 'Favorites'
                    : 'Entire library'}
          </span>
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
            Load more
          </button>
        ) : null}
        <footer className="asset-status">
          <span>{jobProgress ?? status}</span>
          <span>
            {navigation.pendingPreviewCount
              ? `${navigation.pendingPreviewCount} previews queued`
              : 'Preview cache ready'}
          </span>
        </footer>
      </section>

      {inspectorOpen ? (
        <AssetInspector
          key={(selectedAssets.length ? selectedAssets : activeAsset ? [activeAsset] : [])
            .map((asset) => asset.id)
            .join(':')}
          assets={selectedAssets.length ? selectedAssets : activeAsset ? [activeAsset] : []}
          onClose={() => setInspectorOpen(false)}
          onUpdate={updateAssets}
          onReveal={(asset) => void mutate((bridge) => bridge.revealAsset(asset.id))}
          onRegenerate={(items) =>
            void mutate((bridge) => bridge.regeneratePreviews(items.map((item) => item.id)))
          }
        />
      ) : null}
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
