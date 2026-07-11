import { useState, type JSX } from 'react'
import { FolderSearch, RefreshCw, X } from 'lucide-react'
import type {
  AssetKind,
  AssetSummary,
  AssetUpdateRequest,
  OverlayMode
} from '../../../shared/clipdock'

function bytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`
}

export function AssetInspector({
  assets,
  onClose,
  onUpdate,
  onReveal,
  onRegenerate
}: {
  assets: AssetSummary[]
  onClose: () => void
  onUpdate: (request: AssetUpdateRequest) => void
  onReveal: (asset: AssetSummary) => void
  onRegenerate: (assets: AssetSummary[]) => void
}): JSX.Element {
  const primary = assets[0]
  const [tags, setTags] = useState(primary?.tags.join(', ') ?? '')
  const [note, setNote] = useState(primary?.note ?? '')
  const [tagsDirty, setTagsDirty] = useState(false)
  const [noteDirty, setNoteDirty] = useState(false)
  if (!primary)
    return (
      <aside className="asset-inspector empty">
        <button type="button" onClick={onClose} aria-label="Close inspector">
          <X size={17} />
        </button>
        <strong>Inspector</strong>
        <p>Select an asset to inspect and classify it.</p>
      </aside>
    )
  const ids = assets.map((asset) => asset.id)
  return (
    <aside className="asset-inspector">
      <header>
        <div>
          <span>{assets.length > 1 ? `${assets.length} assets` : primary.kind}</span>
          <strong>{assets.length > 1 ? 'Batch edit' : primary.displayName}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Close inspector">
          <X size={17} />
        </button>
      </header>
      {assets.length === 1 ? (
        <div className="inspector-preview">
          {primary.thumbnailUrl ? <img src={primary.thumbnailUrl} alt="" /> : null}
        </div>
      ) : null}
      <label>
        Asset type
        <select
          value={assets.every((asset) => asset.kind === primary.kind) ? primary.kind : ''}
          onChange={(event) =>
            event.target.value && onUpdate({ assetIds: ids, kind: event.target.value as AssetKind })
          }
        >
          <option value="">Mixed</option>
          <option value="transition">Transition</option>
          <option value="overlay">Overlay</option>
          <option value="sound">Sound</option>
          <option value="unknown">Unknown</option>
        </select>
      </label>
      {assets.every((asset) => asset.kind === 'overlay') ? (
        <label>
          Overlay mode
          <select
            value={
              assets.every((asset) => asset.overlayMode === primary.overlayMode)
                ? primary.overlayMode
                : ''
            }
            onChange={(event) =>
              event.target.value &&
              onUpdate({ assetIds: ids, overlayMode: event.target.value as OverlayMode })
            }
          >
            <option value="">Mixed</option>
            <option value="raw">Raw video</option>
            <option value="alpha">Alpha</option>
            <option value="screen">Screen / Add</option>
          </select>
        </label>
      ) : null}
      <label>
        Tags
        <input
          value={tags}
          onChange={(event) => {
            setTags(event.target.value)
            setTagsDirty(true)
          }}
          onBlur={() => {
            if (!tagsDirty) return
            setTagsDirty(false)
            onUpdate({
              assetIds: ids,
              tags: tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean)
            })
          }}
          placeholder="glitch, fast, warm"
        />
      </label>
      {assets.length === 1 ? (
        <label>
          Notes
          <textarea
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
              setNoteDirty(true)
            }}
            onBlur={() => {
              if (!noteDirty) return
              setNoteDirty(false)
              onUpdate({ assetIds: ids, note })
            }}
            placeholder="Usage notes"
          />
        </label>
      ) : null}
      {assets.length === 1 ? (
        <dl className="asset-facts">
          <div>
            <dt>Pack</dt>
            <dd>{primary.packName}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{primary.extension.replace('.', '').toUpperCase()}</dd>
          </div>
          <div>
            <dt>Codec</dt>
            <dd>{primary.codec ?? primary.audioCodec ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{bytes(primary.sizeBytes)}</dd>
          </div>
          {primary.widthPixels ? (
            <div>
              <dt>Resolution</dt>
              <dd>
                {primary.widthPixels} × {primary.heightPixels}
              </dd>
            </div>
          ) : null}
          {primary.sampleRate ? (
            <div>
              <dt>Audio</dt>
              <dd>
                {primary.sampleRate} Hz · {primary.channels ?? '?'} ch
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Compatibility</dt>
            <dd className={`compatibility ${primary.compatibility}`}>{primary.compatibility}</dd>
          </div>
        </dl>
      ) : null}
      {primary.kind === 'transition' ? (
        <p className="usage-note">Place this short clip between two timeline clips.</p>
      ) : null}
      {primary.kind === 'overlay' ? (
        <p className="usage-note">
          Place above footage
          {primary.overlayMode === 'screen' ? ' and use Screen/Add blend mode.' : '.'}
        </p>
      ) : null}
      <div className="inspector-actions">
        <button type="button" onClick={() => onReveal(primary)}>
          <FolderSearch size={16} />
          Reveal
        </button>
        <button type="button" onClick={() => onRegenerate(assets)}>
          <RefreshCw size={16} />
          Rebuild preview
        </button>
      </div>
    </aside>
  )
}
