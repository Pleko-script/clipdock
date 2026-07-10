import type { DragEvent, JSX, MouseEvent } from 'react'
import type { LibraryClipRecordSummary } from '../../../shared/clipdock'
import type { ClipDragReadyState } from './PreviewStage'

const EMPTY_STATUS = 'Add a folder to start building the local video library.'

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

function ClipCard({
  clip,
  selected,
  active,
  dragReadyState,
  onSelect,
  onOpen,
  onDrag,
  onOpenMenu,
  onToggleFavorite
}: {
  clip: LibraryClipRecordSummary
  selected: boolean
  active: boolean
  dragReadyState?: ClipDragReadyState
  onSelect: (event: MouseEvent) => void
  onOpen: () => void
  onDrag: (event: DragEvent<HTMLElement>) => void
  onOpenMenu: (event: MouseEvent) => void
  onToggleFavorite: () => void
}): JSX.Element {
  const requiresRotatedExport = clip.rotationDegrees !== 0
  const isPreparing = requiresRotatedExport && dragReadyState === 'pending'
  const isFailed = requiresRotatedExport && dragReadyState === 'failed'
  const tooltip = isPreparing
    ? 'Preparing rotated export...'
    : isFailed
      ? 'Rotated export failed. Click rotation again to retry.'
      : clip.filePath
  const cardClassName =
    `clip-card${selected ? ' selected' : ''}${active ? ' active' : ''}` +
    `${isPreparing ? ' preparing' : ''}${isFailed ? ' failed' : ''}`

  return (
    <article
      className={cardClassName}
      draggable={!isPreparing}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onDragStart={onDrag}
      onContextMenu={onOpenMenu}
      title={tooltip}
      aria-busy={isPreparing}
    >
      <div className={`thumb rotate-${clip.rotationDegrees}`}>
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

export function ClipGrid({
  clips,
  activeClipId,
  selectedClipIds,
  dragReady,
  onSelectClip,
  onOpenClip,
  onDragClip,
  onOpenClipMenu,
  onToggleFavorite
}: {
  clips: LibraryClipRecordSummary[]
  activeClipId: string | null
  selectedClipIds: Set<string>
  dragReady?: Map<string, ClipDragReadyState>
  onSelectClip: (clip: LibraryClipRecordSummary, event: MouseEvent) => void
  onOpenClip: (clip: LibraryClipRecordSummary) => void
  onDragClip: (clip: LibraryClipRecordSummary, event: DragEvent<HTMLElement>) => void
  onOpenClipMenu: (clip: LibraryClipRecordSummary, event: MouseEvent) => void
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
          dragReadyState={dragReady?.get(clip.id)}
          onSelect={(event) => onSelectClip(clip, event)}
          onOpen={() => onOpenClip(clip)}
          onDrag={(event) => onDragClip(clip, event)}
          onOpenMenu={(event) => onOpenClipMenu(clip, event)}
          onToggleFavorite={() => onToggleFavorite(clip)}
        />
      ))}
    </section>
  )
}
