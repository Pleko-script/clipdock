import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type JSX,
  type MouseEvent
} from 'react'
import type {
  ClipdockApi,
  ClipdockError,
  ClipRotationDegrees,
  LibraryBinRecordSummary,
  LibraryClipRecordSummary,
  LibrarySnapshot,
  ScanEvent,
  ScanSummary
} from '../../shared/clipdock'
import { ClipGrid } from './components/ClipGrid'
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu'
import { PreviewStage } from './components/PreviewStage'
import { Sidebar } from './components/Sidebar'
import { useClipSelection } from './hooks/useClipSelection'

const EMPTY_STATUS = 'Add a folder to start building the local video library.'

function getClipdockApi(): ClipdockApi | null {
  return window.clipdock ?? null
}

function createPreloadError(
  message = 'ClipDock secure preload bridge is unavailable.'
): ClipdockError {
  return { code: 'PRELOAD_IPC_FAILED', message }
}

function scanStatus(summary: ScanSummary): string {
  return `Scan complete: ${summary.importedClips} new, ${summary.updatedClips} updated, ${summary.skippedClips} cached, ${summary.failedClips} with issues.`
}

function clipSearchHaystack(clip: LibraryClipRecordSummary): string {
  return [clip.displayName, clip.filePath, clip.note, ...clip.tags].join(' ').toLocaleLowerCase()
}

function selectedIdsForClip(
  clip: LibraryClipRecordSummary,
  selectedClipIds: Set<string>
): string[] {
  return selectedClipIds.has(clip.id) ? [...selectedClipIds] : [clip.id]
}

function promptForBin(
  bins: LibraryBinRecordSummary[],
  title: string,
  excludedBinId?: string | null
): LibraryBinRecordSummary | null {
  const choices = bins.filter((bin) => bin.id !== excludedBinId)

  if (choices.length === 0) {
    window.alert('No target bins available.')
    return null
  }

  const answer = window.prompt(`${title}\n${choices.map((bin) => bin.name).join(', ')}`)

  if (!answer) return null

  const normalized = answer.trim().toLocaleLowerCase()

  return (
    choices.find(
      (bin) => bin.id === answer.trim() || bin.name.trim().toLocaleLowerCase() === normalized
    ) ?? null
  )
}

function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)
  const [status, setStatus] = useState(
    window.clipdock ? 'Loading library...' : 'Secure preload bridge unavailable.'
  )
  const [lastError, setLastError] = useState<ClipdockError | null>(
    window.clipdock ? null : createPreloadError()
  )
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortMode, setSortMode] = useState('name')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [activeBinId, setActiveBinId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    items: ContextMenuItem[]
  } | null>(null)

  const clips = useMemo(() => snapshot?.clips ?? [], [snapshot])
  const sources = useMemo(() => snapshot?.sources ?? [], [snapshot])
  const bins = useMemo(() => snapshot?.bins ?? [], [snapshot])

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim().toLocaleLowerCase()),
      180
    )

    return () => window.clearTimeout(timer)
  }, [search])

  const filteredClips = useMemo(() => {
    const filtered = clips.filter((clip) => {
      if (favoriteOnly && !clip.favorite) return false
      if (selectedTag && !clip.tags.includes(selectedTag)) return false
      if (activeBinId && !clip.binIds.includes(activeBinId)) return false
      if (debouncedSearch && !clipSearchHaystack(clip).includes(debouncedSearch)) return false

      return true
    })

    return [...filtered].sort((left, right) => {
      if (sortMode === 'modified') return right.modifiedAtMs - left.modifiedAtMs
      if (sortMode === 'duration') return (right.durationMs ?? 0) - (left.durationMs ?? 0)
      if (sortMode === 'size') return right.sizeBytes - left.sizeBytes

      return left.displayName.localeCompare(right.displayName)
    })
  }, [activeBinId, clips, debouncedSearch, favoriteOnly, selectedTag, sortMode])

  const {
    activeClip,
    activeClipId,
    selectedClipIds,
    selectedClipIdsRef,
    setActiveClipId,
    setSelectedClipIds,
    selectClip,
    openClip
  } = useClipSelection(filteredClips)

  const applySnapshot = useCallback((nextSnapshot: LibrarySnapshot): void => {
    setSnapshot(nextSnapshot)
  }, [])

  useEffect(() => {
    const api = getClipdockApi()

    if (!api) return

    let cancelled = false

    async function loadLibrary(clipdock: ClipdockApi): Promise<void> {
      setBusy(true)
      const result = await clipdock.getLibrarySnapshot()

      if (cancelled) return

      if (result.ok) {
        applySnapshot(result.value)
        setStatus(
          result.value.clips.length > 0
            ? `Loaded ${result.value.clips.length} clips.`
            : EMPTY_STATUS
        )
        setLastError(null)
      } else {
        setLastError(result.error)
        setStatus('Library could not be loaded.')
      }

      setBusy(false)
    }

    void loadLibrary(api)

    return () => {
      cancelled = true
    }
  }, [applySnapshot])

  useEffect(() => {
    const api = getClipdockApi()

    if (!api) return

    const unsubscribeScan = api.onScanEvent((event: ScanEvent) => {
      if (event.type === 'scan-started') {
        setBusy(true)
        setStatus(`Scanning ${event.totalFiles} files from ${event.sourceCount} sources...`)
        return
      }

      if (event.type === 'scan-progress') {
        setStatus(`Scanning ${event.scannedFiles}/${event.totalFiles}: ${event.currentFile}`)
        return
      }

      if (event.type === 'scan-file-error') {
        setLastError(event.error)
        setStatus(`Scan issue on ${event.currentFile}`)
        return
      }

      if (event.type === 'scan-completed') {
        setBusy(false)
        setStatus(scanStatus(event.summary))
        return
      }

      setBusy(false)
      setLastError(event.error)
      setStatus('Scan failed.')
    })
    const unsubscribeDrag = api.onClipDragEvent((event) => {
      if (event.type === 'drag-started') {
        setStatus(
          `Native drag started for ${event.clipIds.length} clip${event.clipIds.length === 1 ? '' : 's'}.`
        )
        setLastError(null)
        return
      }

      setLastError(
        event.error ?? { code: 'DRAG_FAILED', phase: 'drag', message: 'Native drag failed.' }
      )
      setStatus('Native drag failed.')
    })

    return () => {
      unsubscribeScan()
      unsubscribeDrag()
    }
  }, [])

  const runSnapshotAction = useCallback(
    async (
      action: () => Promise<
        { ok: true; value: LibrarySnapshot } | { ok: false; error: ClipdockError }
      >,
      busyLabel: string
    ) => {
      setBusy(true)
      setStatus(busyLabel)
      const result = await action()

      if (result.ok) {
        applySnapshot(result.value)
        setLastError(null)
        setStatus(`Loaded ${result.value.clips.length} clips.`)
      } else {
        setLastError(result.error)
        setStatus(result.error.message)
      }

      setBusy(false)
    },
    [applySnapshot]
  )

  const handleAddFolder = useCallback(async (): Promise<void> => {
    const api = getClipdockApi()

    if (!api) {
      setLastError(createPreloadError())
      return
    }

    setBusy(true)
    setStatus('Opening folder picker...')
    const result = await api.addLinkedFolder()

    if (result.ok) {
      applySnapshot(result.value.snapshot)
      setStatus(scanStatus(result.value.summary))
      setLastError(null)
    } else {
      setStatus(result.error.code === 'CANCELLED' ? 'Add folder cancelled.' : result.error.message)
      setLastError(result.error.code === 'CANCELLED' ? null : result.error)
    }

    setBusy(false)
  }, [applySnapshot])

  const handleCopyVideos = useCallback(async (): Promise<void> => {
    const api = getClipdockApi()

    if (!api) {
      setLastError(createPreloadError())
      return
    }

    setBusy(true)
    setStatus('Opening video picker...')
    const result = await api.copyVideosIntoLibrary()

    if (result.ok) {
      applySnapshot(result.value.snapshot)
      setStatus(`Copied import complete: ${result.value.summary.createdClipCount} new clips.`)
      setLastError(result.value.summary.errors[0] ?? null)
    } else {
      setStatus(result.error.code === 'CANCELLED' ? 'Copy videos cancelled.' : result.error.message)
      setLastError(result.error.code === 'CANCELLED' ? null : result.error)
    }

    setBusy(false)
  }, [applySnapshot])

  const handleRescan = useCallback(async (): Promise<void> => {
    const api = getClipdockApi()

    if (!api) {
      setLastError(createPreloadError())
      return
    }

    setBusy(true)
    setStatus('Starting rescan...')
    const result = await api.rescanLibrary()

    if (result.ok) {
      applySnapshot(result.value.snapshot)
      setStatus(scanStatus(result.value.summary))
      setLastError(null)
    } else {
      setStatus(result.error.message)
      setLastError(result.error)
    }

    setBusy(false)
  }, [applySnapshot])

  const handleDragClip = useCallback(
    (clip: LibraryClipRecordSummary, event: DragEvent<HTMLElement>): void => {
      const api = getClipdockApi()

      if (!api) {
        setLastError(createPreloadError())
        return
      }

      const selectedIds = selectedIdsForClip(clip, selectedClipIdsRef.current)

      event.dataTransfer.setData('application/x-clipdock-clip-ids', JSON.stringify(selectedIds))
      setSelectedClipIds(new Set(selectedIds))
      setActiveClipId(clip.id)
      setStatus(
        `Starting native drag for ${selectedIds.length} clip${selectedIds.length === 1 ? '' : 's'}...`
      )
      api.startClipDrag({ clipIds: selectedIds })
    },
    [selectedClipIdsRef, setActiveClipId, setSelectedClipIds]
  )

  const handleToggleFavorite = useCallback(
    async (clip: LibraryClipRecordSummary): Promise<void> => {
      const api = getClipdockApi()

      if (!api) return
      await runSnapshotAction(() => api.toggleFavorite(clip.id), 'Updating favorite...')
    },
    [runSnapshotAction]
  )

  const handleUpdateTags = useCallback(
    async (clip: LibraryClipRecordSummary, tags: string[]): Promise<void> => {
      const api = getClipdockApi()

      if (!api) return
      await runSnapshotAction(() => api.updateClipTags(clip.id, tags), 'Saving tags...')
    },
    [runSnapshotAction]
  )

  const handleUpdateNote = useCallback(
    async (clip: LibraryClipRecordSummary, note: string): Promise<void> => {
      const api = getClipdockApi()

      if (!api) return
      await runSnapshotAction(() => api.updateClipNote(clip.id, note), 'Saving note...')
    },
    [runSnapshotAction]
  )

  const handleUpdateRotation = useCallback(
    async (clip: LibraryClipRecordSummary, rotationDegrees: ClipRotationDegrees): Promise<void> => {
      const api = getClipdockApi()

      if (!api) return
      await runSnapshotAction(
        () => api.updateClipRotation(clip.id, rotationDegrees),
        'Saving rotation...'
      )
    },
    [runSnapshotAction]
  )

  const handleReveal = useCallback(async (clip: LibraryClipRecordSummary): Promise<void> => {
    const api = getClipdockApi()

    if (!api) return
    const result = await api.revealClip(clip.id)

    if (!result.ok) setLastError(result.error)
  }, [])

  const handleCopyPath = useCallback(async (clip: LibraryClipRecordSummary): Promise<void> => {
    const api = getClipdockApi()

    if (!api) return
    const result = await api.copyClipPath(clip.id)

    if (result.ok) {
      setStatus('Path copied.')
    } else {
      setLastError(result.error)
    }
  }, [])

  const handleCreateBin = useCallback(async (): Promise<void> => {
    const name = window.prompt('Bin name')
    const api = getClipdockApi()

    if (!api || !name) return
    await runSnapshotAction(() => api.createBin(name), 'Creating bin...')
  }, [runSnapshotAction])

  const handleRenameBin = useCallback(
    async (binId: string): Promise<void> => {
      const current = bins.find((bin) => bin.id === binId)
      const name = window.prompt('Bin name', current?.name ?? '')
      const api = getClipdockApi()

      if (!api || !name) return
      await runSnapshotAction(() => api.renameBin(binId, name), 'Renaming bin...')
    },
    [bins, runSnapshotAction]
  )

  const handleDeleteBin = useCallback(
    async (binId: string): Promise<void> => {
      const api = getClipdockApi()

      if (!api || !window.confirm('Delete this bin from ClipDock?')) return
      await runSnapshotAction(() => api.deleteBin(binId), 'Deleting bin...')
      if (activeBinId === binId) setActiveBinId(null)
    },
    [activeBinId, runSnapshotAction]
  )

  const handleDropClipsToBin = useCallback(
    async (clipIds: string[], binId: string): Promise<void> => {
      const api = getClipdockApi()

      if (!api || clipIds.length === 0) return
      await runSnapshotAction(() => api.addClipsToBin(clipIds, binId), 'Adding clips to bin...')
    },
    [runSnapshotAction]
  )

  const handleOpenClipMenu = useCallback(
    (clip: LibraryClipRecordSummary, event: MouseEvent): void => {
      event.preventDefault()

      const api = getClipdockApi()
      const clipIds = selectedIdsForClip(clip, selectedClipIdsRef.current)
      const items: ContextMenuItem[] = [
        {
          id: 'favorite',
          label: clip.favorite ? 'Remove favorite' : 'Mark favorite',
          onSelect: () => void handleToggleFavorite(clip)
        },
        {
          id: 'add-to-bin',
          label: 'Add to bin',
          disabled: bins.length === 0,
          onSelect: () => {
            const bin = promptForBin(bins, 'Add to bin')

            if (api && bin) {
              void runSnapshotAction(
                () => api.addClipsToBin(clipIds, bin.id),
                'Adding clips to bin...'
              )
            }
          }
        },
        {
          id: 'move-to-bin',
          label: 'Move to bin',
          disabled: !activeBinId || bins.length < 2,
          onSelect: () => {
            const bin = promptForBin(bins, 'Move to bin', activeBinId)

            if (api && bin && activeBinId) {
              void runSnapshotAction(
                () => api.moveClipsToBin(clipIds, activeBinId, bin.id),
                'Moving clips...'
              )
            }
          }
        },
        {
          id: 'remove-from-bin',
          label: 'Remove from current bin',
          disabled: !activeBinId,
          onSelect: () => {
            if (api && activeBinId) {
              void runSnapshotAction(
                () => api.removeClipsFromBin(clipIds, activeBinId),
                'Removing clips from bin...'
              )
            }
          }
        },
        {
          id: 'reveal',
          label: 'Reveal in Explorer',
          onSelect: () => void handleReveal(clip)
        },
        {
          id: 'copy-path',
          label: 'Copy Path',
          onSelect: () => void handleCopyPath(clip)
        },
        {
          id: 'remove-library',
          label: 'Remove from ClipDock',
          destructive: true,
          onSelect: () => {
            if (
              api &&
              window.confirm('Remove selected clips from ClipDock? Source files stay on disk.')
            ) {
              void runSnapshotAction(
                () => api.removeClipsFromLibrary(clipIds),
                'Removing clips from ClipDock...'
              )
            }
          }
        }
      ]

      setContextMenu({ x: event.clientX, y: event.clientY, items })
    },
    [
      activeBinId,
      bins,
      handleCopyPath,
      handleReveal,
      handleToggleFavorite,
      runSnapshotAction,
      selectedClipIdsRef
    ]
  )

  const handleOpenBinMenu = useCallback(
    (binId: string, x: number, y: number): void => {
      setContextMenu({
        x,
        y,
        items: [
          {
            id: 'rename-bin',
            label: 'Rename bin',
            onSelect: () => void handleRenameBin(binId)
          },
          {
            id: 'delete-bin',
            label: 'Delete bin',
            destructive: true,
            onSelect: () => void handleDeleteBin(binId)
          }
        ]
      })
    },
    [handleDeleteBin, handleRenameBin]
  )

  return (
    <main className="app-shell">
      <Sidebar
        sources={sources}
        clips={clips}
        bins={bins}
        selectedTag={selectedTag}
        favoriteOnly={favoriteOnly}
        activeBinId={activeBinId}
        onSelectTag={(tag) => {
          setSelectedTag(tag)
          setFavoriteOnly(false)
          setActiveBinId(null)
        }}
        onShowFavorites={() => {
          setFavoriteOnly(true)
          setSelectedTag(null)
          setActiveBinId(null)
        }}
        onShowAll={() => {
          setFavoriteOnly(false)
          setSelectedTag(null)
          setActiveBinId(null)
        }}
        onSelectBin={(binId) => {
          setActiveBinId(binId)
          setFavoriteOnly(false)
          setSelectedTag(null)
        }}
        onAddFolder={handleAddFolder}
        onCopyVideos={handleCopyVideos}
        onCreateBin={handleCreateBin}
        onOpenBinMenu={handleOpenBinMenu}
        onDropClipsToBin={handleDropClipsToBin}
        busy={busy}
      />

      <section className="library-view">
        <header className="topbar">
          <div className="search-wrap">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search filename, path, tags, notes"
            />
          </div>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value)}
            aria-label="Sort clips"
          >
            <option value="name">Name</option>
            <option value="modified">Modified</option>
            <option value="duration">Duration</option>
            <option value="size">Size</option>
          </select>
          <label className="toggle">
            <input
              type="checkbox"
              checked={favoriteOnly}
              onChange={(event) => {
                setFavoriteOnly(event.target.checked)
                setActiveBinId(null)
              }}
            />
            Favorites
          </label>
          <button type="button" className="ghost-button" onClick={handleRescan} disabled={busy}>
            Rescan
          </button>
        </header>

        <PreviewStage
          clip={activeClip}
          onToggleFavorite={handleToggleFavorite}
          onUpdateTags={handleUpdateTags}
          onUpdateNote={handleUpdateNote}
          onReveal={handleReveal}
          onCopyPath={handleCopyPath}
          onRotate={handleUpdateRotation}
        />

        <div className="library-meta">
          <span>{filteredClips.length} visible</span>
          <span>{selectedClipIds.size} selected</span>
          <span>{busy ? 'Busy' : 'Ready'}</span>
        </div>

        <ClipGrid
          clips={filteredClips}
          activeClipId={activeClipId}
          selectedClipIds={selectedClipIds}
          onSelectClip={selectClip}
          onOpenClip={openClip}
          onDragClip={handleDragClip}
          onOpenClipMenu={handleOpenClipMenu}
          onToggleFavorite={handleToggleFavorite}
        />

        <footer className="status-bar">
          <span>{status}</span>
          {lastError ? (
            <strong>
              {lastError.code}: {lastError.message}
            </strong>
          ) : null}
        </footer>
      </section>

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </main>
  )
}

export default App
