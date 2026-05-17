import type { DragEvent, JSX, MouseEvent } from 'react'
import type {
  LibraryBinRecordSummary,
  LibraryClipRecordSummary,
  LibrarySourceRecordSummary
} from '../../../shared/clipdock'

function allTags(clips: LibraryClipRecordSummary[]): string[] {
  return [...new Set(clips.flatMap((clip) => clip.tags))].sort((left, right) =>
    left.localeCompare(right)
  )
}

function parseClipIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value)

    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function Sidebar({
  sources,
  clips,
  bins,
  selectedTag,
  favoriteOnly,
  activeBinId,
  onSelectTag,
  onShowFavorites,
  onShowAll,
  onSelectBin,
  onAddFolder,
  onCopyVideos,
  onCreateBin,
  onOpenBinMenu,
  onDropClipsToBin,
  busy
}: {
  sources: LibrarySourceRecordSummary[]
  clips: LibraryClipRecordSummary[]
  bins: LibraryBinRecordSummary[]
  selectedTag: string | null
  favoriteOnly: boolean
  activeBinId: string | null
  onSelectTag: (tag: string) => void
  onShowFavorites: () => void
  onShowAll: () => void
  onSelectBin: (binId: string | null) => void
  onAddFolder: () => void
  onCopyVideos: () => void
  onCreateBin: () => void
  onOpenBinMenu: (binId: string, x: number, y: number) => void
  onDropClipsToBin: (clipIds: string[], binId: string) => void
  busy: boolean
}): JSX.Element {
  const tags = allTags(clips)

  const handleDrop = (event: DragEvent<HTMLButtonElement>, binId: string): void => {
    event.preventDefault()
    onDropClipsToBin(
      parseClipIds(event.dataTransfer.getData('application/x-clipdock-clip-ids')),
      binId
    )
  }

  const handleBinMenu = (event: MouseEvent<HTMLButtonElement>, binId: string): void => {
    event.preventDefault()
    onOpenBinMenu(binId, event.clientX, event.clientY)
  }

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
          className={!favoriteOnly && !selectedTag && !activeBinId ? 'active' : ''}
          onClick={onShowAll}
        >
          All Clips <span>{clips.length}</span>
        </button>
        <button type="button" className={favoriteOnly ? 'active' : ''} onClick={onShowFavorites}>
          Favorites <span>{clips.filter((clip) => clip.favorite).length}</span>
        </button>
      </nav>

      <section className="sidebar-section bins">
        <div className="section-heading-row">
          <h2>Bins</h2>
          <button type="button" onClick={onCreateBin} disabled={busy}>
            Add Bin
          </button>
        </div>
        {bins.length === 0 ? <span className="muted">No bins</span> : null}
        {bins.map((bin) => (
          <button
            type="button"
            key={bin.id}
            className={activeBinId === bin.id ? 'bin-row active' : 'bin-row'}
            onClick={() => onSelectBin(bin.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, bin.id)}
            onContextMenu={(event) => handleBinMenu(event, bin.id)}
          >
            <strong>{bin.name}</strong>
            <span>{bin.clipCount}</span>
          </button>
        ))}
      </section>

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
