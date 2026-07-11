import { useState, type JSX } from 'react'
import { Heart, X } from 'lucide-react'
import type { AssetSummary } from '../../../shared/clipdock'

export function QuickLook({
  asset,
  onClose,
  onFavorite
}: {
  asset: AssetSummary
  onClose: () => void
  onFavorite: () => void
}): JSX.Element {
  const [original, setOriginal] = useState(false)
  const source = original || !asset.previewUrl ? asset.mediaUrl : asset.previewUrl
  return (
    <div className="quick-look-backdrop" onMouseDown={onClose}>
      <section className="quick-look" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{asset.packName}</span>
            <strong>{asset.displayName}</strong>
          </div>
          <div>
            <button type="button" className={asset.favorite ? 'active' : ''} onClick={onFavorite}>
              <Heart size={17} fill={asset.favorite ? 'currentColor' : 'none'} />
            </button>
            <button type="button" onClick={onClose}>
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="quick-look-media">
          {asset.mediaType === 'video' ? (
            <video key={source} src={source} autoPlay controls loop={asset.kind !== 'transition'} />
          ) : (
            <div className="quick-look-audio">
              {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" /> : null}
              <audio src={asset.mediaUrl} autoPlay controls />
            </div>
          )}
        </div>
        <footer>
          <span>
            {asset.kind} · {asset.extension.replace('.', '').toUpperCase()} ·{' '}
            {asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)}s` : 'Unknown duration'}
          </span>
          {asset.previewUrl ? (
            <div>
              <button
                type="button"
                className={!original ? 'active' : ''}
                onClick={() => setOriginal(false)}
              >
                Context
              </button>
              <button
                type="button"
                className={original ? 'active' : ''}
                onClick={() => setOriginal(true)}
              >
                Original
              </button>
            </div>
          ) : null}
        </footer>
      </section>
    </div>
  )
}
