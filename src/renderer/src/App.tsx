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
import type {
  ClipdockApi,
  ClipdockError,
  LibraryClipRecordSummary,
  LibrarySnapshot,
  LibrarySourceRecordSummary,
  ScanEvent,
  ScanSummary
} from '../../shared/clipdock'

const EMPTY_STATUS = 'Add a folder to start building the local video library.'

function getClipdockApi(): ClipdockApi | null {
  return window.clipdock ?? null
}

function createPreloadError(
  message = 'ClipDock secure preload bridge is unavailable.'
): ClipdockError {
  return { code: 'PRELOAD_IPC_FAILED', message }
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes <= 0) return '0 MB'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = sizeBytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 10 ? 0 : 1
  }).format(value)} ${units[unitIndex]}`
}

function formatDuration(durationMs: number | null): string {
  if (!durationMs || durationMs <= 0) return '--:--'

  const totalSeconds = Math.round(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatResolution(clip: LibraryClipRecordSummary): string {
  return clip.widthPixels && clip.heightPixels
    ? `${clip.widthPixels} x ${clip.heightPixels}`
    : 'Unknown'
}

function formatDate(timestampMs: number | null): string {
  if (!timestampMs) return 'Unknown'

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(timestampMs)
  )
}

function scanStatus(summary: ScanSummary): string {
  return `Scan complete: ${summary.importedClips} new, ${summary.updatedClips} updated, ${summary.skippedClips} cached, ${summary.failedClips} with issues.`
}

function clipSearchHaystack(clip: LibraryClipRecordSummary): string {
  return [clip.displayName, clip.filePath, clip.note, ...clip.tags].join(' ').toLocaleLowerCase()
}

function allTags(clips: LibraryClipRecordSummary[]): string[] {
  return [...new Set(clips.flatMap((clip) => clip.tags))].sort((left, right) =>
    left.localeCompare(right)
  )
}

function Sidebar({
  sources,
  clips,
  selectedTag,
  favoriteOnly,
  onSelectTag,
  onShowFavorites,
  onShowAll,
  onAddFolder,
  onCopyVideos,
  busy
}: {
  sources: LibrarySourceRecordSummary[]
  clips: LibraryClipRecordSummary[]
  selectedTag: string | null
  favoriteOnly: boolean
  onSelectTag: (tag: string) => void
  onShowFavorites: () => void
  onShowAll: () => void
  onAddFolder: () => void
  onCopyVideos: () => void
  busy: boolean
}): JSX.Element {
  const tags = allTags(clips)

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">CD</span>
        <div>
          <h1>ClipDock</h1>
          <p>Local video library</p>
        </div>
      </div>

      <div className="sidebar-actions">
        <button type="button" className="primary-button" onClick={onAddFolder} disabled={busy}>
          Add Folder
        </button>
        <button type="button" className="ghost-button" onClick={onCopyVideos} disabled={busy}>
          Copy Videos
        </button>
      </div>

      <nav className="nav-list" aria-label="Library filters">
        <button
          type="button"
          className={!favoriteOnly && !selectedTag ? 'active' : ''}
          onClick={onShowAll}
        >
          All Clips <span>{clips.length}</span>
        </button>
        <button type="button" className={favoriteOnly ? 'active' : ''} onClick={onShowFavorites}>
          Favorites <span>{clips.filter((clip) => clip.favorite).length}</span>
        </button>
      </nav>

      <section className="sidebar-section">
        <h2>Tags</h2>
        <div className="tag-list">
          {tags.length === 0 ? <span className="muted">No tags</span> : null}
          {tags.map((tag) => (
            <button
              type="button"
              key={tag}
              className={selectedTag === tag ? 'tag-filter active' : 'tag-filter'}
              onClick={() => onSelectTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar-section sources">
        <h2>Folders</h2>
        {sources.length === 0 ? <span className="muted">No folders</span> : null}
        {sources.map((source) => (
          <div className="source-row" key={source.id} title={source.displayLocation}>
            <strong>{source.displayName}</strong>
            <span>{source.clipCount} clips</span>
          </div>
        ))}
      </section>
    </aside>
  )
}

function ClipCard({
  clip,
  selected,
  active,
  onSelect,
  onOpen,
  onDrag,
  onToggleFavorite
}: {
  clip: LibraryClipRecordSummary
  selected: boolean
  active: boolean
  onSelect: (event: MouseEvent) => void
  onOpen: () => void
  onDrag: (event: DragEvent<HTMLElement>) => void
  onToggleFavorite: () => void
}): JSX.Element {
  return (
    <article
      className={`clip-card${selected ? ' selected' : ''}${active ? ' active' : ''}`}
      draggable
      onClick={onSelect}
      onDoubleClick={onOpen}
      onDragStart={onDrag}
      title={clip.filePath}
    >
      <div className="thumb">
        {clip.thumbnailUrl ? (
          <img src={clip.thumbnailUrl} loading="lazy" alt="" draggable={false} />
        ) : null}
        {!clip.thumbnailUrl ? <div className="thumb-placeholder">No thumbnail</div> : null}
        <span>{formatDuration(clip.durationMs)}</span>
      </div>
      <div className="clip-card-body">
        <div className="clip-card-title">
          <h3>{clip.displayName}</h3>
          <button
            type="button"
            className={clip.favorite ? 'favorite active' : 'favorite'}
            onClick={(event) => {
              event.stopPropagation()
              onToggleFavorite()
            }}
            aria-label={clip.favorite ? 'Remove favorite' : 'Mark favorite'}
          >
            {clip.favorite ? 'Fav' : 'Star'}
          </button>
        </div>
        <p>
          {formatResolution(clip)} {clip.codec ? `| ${clip.codec}` : ''}
        </p>
        <div className="clip-tags">
          {clip.tags.slice(0, 3).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
    </article>
  )
}

function ClipGrid({
  clips,
  activeClipId,
  selectedClipIds,
  onSelectClip,
  onOpenClip,
  onDragClip,
  onToggleFavorite
}: {
  clips: LibraryClipRecordSummary[]
  activeClipId: string | null
  selectedClipIds: Set<string>
  onSelectClip: (clip: LibraryClipRecordSummary, event: MouseEvent) => void
  onOpenClip: (clip: LibraryClipRecordSummary) => void
  onDragClip: (clip: LibraryClipRecordSummary, event: DragEvent<HTMLElement>) => void
  onToggleFavorite: (clip: LibraryClipRecordSummary) => void
}): JSX.Element {
  if (clips.length === 0) {
    return (
      <div className="empty-grid">
        <strong>No clips</strong>
        <span>{EMPTY_STATUS}</span>
      </div>
    )
  }

  return (
    <section className="clip-grid" aria-label="Clip grid">
      {clips.map((clip) => (
        <ClipCard
          key={clip.id}
          clip={clip}
          selected={selectedClipIds.has(clip.id)}
          active={activeClipId === clip.id}
          onSelect={(event) => onSelectClip(clip, event)}
          onOpen={() => onOpenClip(clip)}
          onDrag={(event) => onDragClip(clip, event)}
          onToggleFavorite={() => onToggleFavorite(clip)}
        />
      ))}
    </section>
  )
}

function TagEditor({
  clip,
  onSave
}: {
  clip: LibraryClipRecordSummary
  onSave: (tags: string[]) => void
}): JSX.Element {
  const [draft, setDraft] = useState('')

  const removeTag = (tag: string): void => {
    onSave(clip.tags.filter((existing) => existing !== tag))
  }

  const addTag = (): void => {
    const tag = draft.trim().replace(/\s+/g, ' ')

    if (tag.length === 0) return

    onSave([...new Set([...clip.tags, tag])])
    setDraft('')
  }

  return (
    <div className="tag-editor">
      <div className="editable-tags">
        {clip.tags.length === 0 ? <span className="muted">No tags</span> : null}
        {clip.tags.map((tag) => (
          <button type="button" key={tag} onClick={() => removeTag(tag)}>
            {tag} x
          </button>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addTag()
          }}
          placeholder="Add tag"
        />
        <button type="button" onClick={addTag}>
          Add
        </button>
      </div>
    </div>
  )
}

function NoteEditor({
  clip,
  onSave
}: {
  clip: LibraryClipRecordSummary
  onSave: (note: string) => void
}): JSX.Element {
  const [noteDraft, setNoteDraft] = useState(clip.note)

  return (
    <>
      <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} />
      <button type="button" className="ghost-button" onClick={() => onSave(noteDraft)}>
        Save Note
      </button>
    </>
  )
}

function DetailsPanel({
  clip,
  onToggleFavorite,
  onUpdateTags,
  onUpdateNote,
  onReveal,
  onCopyPath
}: {
  clip: LibraryClipRecordSummary | null
  onToggleFavorite: (clip: LibraryClipRecordSummary) => void
  onUpdateTags: (clip: LibraryClipRecordSummary, tags: string[]) => void
  onUpdateNote: (clip: LibraryClipRecordSummary, note: string) => void
  onReveal: (clip: LibraryClipRecordSummary) => void
  onCopyPath: (clip: LibraryClipRecordSummary) => void
}): JSX.Element {
  if (!clip) {
    return (
      <aside className="details-panel empty">
        <strong>No clip selected</strong>
        <span>Select a clip to preview it.</span>
      </aside>
    )
  }

  return (
    <aside className="details-panel">
      <video className="preview-video" src={clip.previewUrl} controls preload="metadata" />
      <div className="details-heading">
        <div>
          <h2>{clip.displayName}</h2>
          <p>{clip.filePath}</p>
        </div>
        <button
          type="button"
          className={clip.favorite ? 'favorite large active' : 'favorite large'}
          onClick={() => onToggleFavorite(clip)}
        >
          {clip.favorite ? 'Favorite' : 'Star'}
        </button>
      </div>

      <dl className="metadata-grid">
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(clip.durationMs)}</dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd>{formatResolution(clip)}</dd>
        </div>
        <div>
          <dt>FPS</dt>
          <dd>{clip.fps ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt>Codec</dt>
          <dd>{clip.codec ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(clip.sizeBytes)}</dd>
        </div>
        <div>
          <dt>Modified</dt>
          <dd>{formatDate(clip.modifiedAtMs)}</dd>
        </div>
      </dl>

      <section className="detail-section">
        <h3>Tags</h3>
        <TagEditor key={clip.id} clip={clip} onSave={(tags) => onUpdateTags(clip, tags)} />
      </section>

      <section className="detail-section">
        <h3>Notes</h3>
        <NoteEditor key={clip.id} clip={clip} onSave={(note) => onUpdateNote(clip, note)} />
      </section>

      <div className="detail-actions">
        <button type="button" onClick={() => onReveal(clip)}>
          Reveal in Explorer
        </button>
        <button type="button" onClick={() => onCopyPath(clip)}>
          Copy Path
        </button>
      </div>
    </aside>
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
  const [activeClipId, setActiveClipId] = useState<string | null>(null)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const selectedClipIdsRef = useRef(selectedClipIds)
  const activeClipIdRef = useRef(activeClipId)

  useEffect(() => {
    selectedClipIdsRef.current = selectedClipIds
  }, [selectedClipIds])

  useEffect(() => {
    activeClipIdRef.current = activeClipId
  }, [activeClipId])

  const clips = useMemo(() => snapshot?.clips ?? [], [snapshot])
  const sources = useMemo(() => snapshot?.sources ?? [], [snapshot])
  const activeClip = clips.find((clip) => clip.id === activeClipId) ?? clips[0] ?? null

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
      if (debouncedSearch && !clipSearchHaystack(clip).includes(debouncedSearch)) return false

      return true
    })

    return [...filtered].sort((left, right) => {
      if (sortMode === 'modified') return right.modifiedAtMs - left.modifiedAtMs
      if (sortMode === 'duration') return (right.durationMs ?? 0) - (left.durationMs ?? 0)
      if (sortMode === 'size') return right.sizeBytes - left.sizeBytes

      return left.displayName.localeCompare(right.displayName)
    })
  }, [clips, debouncedSearch, favoriteOnly, selectedTag, sortMode])

  const applySnapshot = useCallback((nextSnapshot: LibrarySnapshot): void => {
    setSnapshot(nextSnapshot)
    setSelectedClipIds(
      (current) =>
        new Set(
          [...current].filter((clipId) => nextSnapshot.clips.some((clip) => clip.id === clipId))
        )
    )

    const currentActiveClipId = activeClipIdRef.current

    if (
      !currentActiveClipId ||
      !nextSnapshot.clips.some((clip) => clip.id === currentActiveClipId)
    ) {
      setActiveClipId(nextSnapshot.clips[0]?.id ?? null)
    }
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

  const handleSelectClip = useCallback(
    (clip: LibraryClipRecordSummary, event: MouseEvent): void => {
      setActiveClipId(clip.id)
      setSelectedClipIds((current) => {
        const next = new Set(event.metaKey || event.ctrlKey ? current : [])

        if (event.metaKey || event.ctrlKey) {
          if (next.has(clip.id)) next.delete(clip.id)
          else next.add(clip.id)
        } else {
          next.add(clip.id)
        }

        return next
      })
    },
    []
  )

  const handleOpenClip = useCallback((clip: LibraryClipRecordSummary): void => {
    setActiveClipId(clip.id)
    setSelectedClipIds(new Set([clip.id]))
  }, [])

  const handleDragClip = useCallback(
    (clip: LibraryClipRecordSummary, event: DragEvent<HTMLElement>): void => {
      event.preventDefault()
      const api = getClipdockApi()

      if (!api) {
        setLastError(createPreloadError())
        return
      }

      const selectedIds = selectedClipIdsRef.current.has(clip.id)
        ? [...selectedClipIdsRef.current]
        : [clip.id]

      setSelectedClipIds(new Set(selectedIds))
      setActiveClipId(clip.id)
      setStatus(
        `Starting native drag for ${selectedIds.length} clip${selectedIds.length === 1 ? '' : 's'}...`
      )
      api.startClipDrag({ clipIds: selectedIds })
    },
    []
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

  return (
    <main className="app-shell">
      <Sidebar
        sources={sources}
        clips={clips}
        selectedTag={selectedTag}
        favoriteOnly={favoriteOnly}
        onSelectTag={(tag) => {
          setSelectedTag(tag)
          setFavoriteOnly(false)
        }}
        onShowFavorites={() => {
          setFavoriteOnly(true)
          setSelectedTag(null)
        }}
        onShowAll={() => {
          setFavoriteOnly(false)
          setSelectedTag(null)
        }}
        onAddFolder={handleAddFolder}
        onCopyVideos={handleCopyVideos}
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
              onChange={(event) => setFavoriteOnly(event.target.checked)}
            />
            Favorites
          </label>
          <button type="button" className="ghost-button" onClick={handleRescan} disabled={busy}>
            Rescan
          </button>
        </header>

        <div className="library-meta">
          <span>{filteredClips.length} visible</span>
          <span>{selectedClipIds.size} selected</span>
          <span>{busy ? 'Busy' : 'Ready'}</span>
        </div>

        <ClipGrid
          clips={filteredClips}
          activeClipId={activeClip?.id ?? null}
          selectedClipIds={selectedClipIds}
          onSelectClip={handleSelectClip}
          onOpenClip={handleOpenClip}
          onDragClip={handleDragClip}
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

      <DetailsPanel
        clip={activeClip}
        onToggleFavorite={handleToggleFavorite}
        onUpdateTags={handleUpdateTags}
        onUpdateNote={handleUpdateNote}
        onReveal={handleReveal}
        onCopyPath={handleCopyPath}
      />
    </main>
  )
}

export default App
