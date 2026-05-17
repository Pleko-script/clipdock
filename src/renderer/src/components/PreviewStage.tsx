import { useState, type DragEvent, type JSX } from 'react'
import type { ClipRotationDegrees, LibraryClipRecordSummary } from '../../../shared/clipdock'

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

export function PreviewStage({
  clip,
  onToggleFavorite,
  onUpdateTags,
  onUpdateNote,
  onReveal,
  onCopyPath,
  onDragClip,
  onRotate
}: {
  clip: LibraryClipRecordSummary | null
  onToggleFavorite: (clip: LibraryClipRecordSummary) => void
  onUpdateTags: (clip: LibraryClipRecordSummary, tags: string[]) => void
  onUpdateNote: (clip: LibraryClipRecordSummary, note: string) => void
  onReveal: (clip: LibraryClipRecordSummary) => void
  onCopyPath: (clip: LibraryClipRecordSummary) => void
  onDragClip: (clip: LibraryClipRecordSummary, event: DragEvent<HTMLElement>) => void
  onRotate: (clip: LibraryClipRecordSummary, rotationDegrees: ClipRotationDegrees) => void
}): JSX.Element {
  if (!clip) {
    return (
      <section className="preview-stage empty">
        <strong>No clip selected</strong>
        <span>Select a clip to preview it.</span>
      </section>
    )
  }

  return (
    <section className="preview-stage">
      <div
        className="preview-video-shell"
        draggable
        onDragStart={(event) => onDragClip(clip, event)}
        title="Drag preview to timeline"
      >
        <video
          className={`preview-video rotate-${clip.rotationDegrees}`}
          src={clip.previewUrl}
          controls
          draggable={false}
          preload="metadata"
        />
      </div>
      <div className="preview-info">
        <div className="preview-heading">
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

        <div className="rotation-controls" aria-label="Video rotation">
          {[0, 90, 180, 270].map((degrees) => (
            <button
              type="button"
              key={degrees}
              className={clip.rotationDegrees === degrees ? 'active' : ''}
              onClick={() => onRotate(clip, degrees as ClipRotationDegrees)}
            >
              {degrees}°
            </button>
          ))}
        </div>

        <dl className="metadata-strip">
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

        <div className="preview-actions">
          <button type="button" onClick={() => onReveal(clip)}>
            Reveal in Explorer
          </button>
          <button type="button" onClick={() => onCopyPath(clip)}>
            Copy Path
          </button>
        </div>

        <div className="preview-editors">
          <section className="detail-section">
            <h3>Tags</h3>
            <TagEditor
              key={`${clip.id}-tags`}
              clip={clip}
              onSave={(tags) => onUpdateTags(clip, tags)}
            />
          </section>
          <section className="detail-section">
            <h3>Notes</h3>
            <NoteEditor
              key={`${clip.id}-note`}
              clip={clip}
              onSave={(note) => onUpdateNote(clip, note)}
            />
          </section>
        </div>
      </div>
    </section>
  )
}
