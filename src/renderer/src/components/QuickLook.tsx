import { useState, type JSX } from 'react'
import { Heart, X } from 'lucide-react'
import type { AssetSummary } from '../../../shared/clipdock'
import { useI18n } from '../i18n'
import { AudioPreviewEditor } from './AudioPreviewEditor'

export function QuickLook({
  asset,
  onClose,
  onFavorite
}: {
  asset: AssetSummary
  onClose: () => void
  onFavorite: () => void
}): JSX.Element {
  const { kind, t } = useI18n()
  const [original, setOriginal] = useState(false)
  const source = original || !asset.previewUrl ? asset.mediaUrl : asset.previewUrl
  const applyStoredVolume = (media: HTMLMediaElement): void => {
    const value = window.localStorage.getItem('clipdock.previewVolume')
    const stored = value === null ? Number.NaN : Number(value)
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) media.volume = stored
  }
  return (
    <div className="quick-look-backdrop" onMouseDown={onClose}>
      <section
        className="quick-look"
        role="dialog"
        aria-modal="true"
        aria-label={t('quick.aria', { name: asset.displayName })}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{asset.packName}</span>
            <strong>{asset.displayName}</strong>
          </div>
          <div>
            <button
              type="button"
              className={asset.favorite ? 'active' : ''}
              onClick={onFavorite}
              aria-label={asset.favorite ? t('grid.removeFavorite') : t('grid.addFavorite')}
            >
              <Heart size={17} fill={asset.favorite ? 'currentColor' : 'none'} />
            </button>
            <button type="button" onClick={onClose} aria-label={t('quick.close')}>
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="quick-look-media">
          {asset.mediaType === 'video' ? (
            <video
              key={source}
              src={source}
              autoPlay
              controls
              loop={asset.kind !== 'transition'}
              onLoadedMetadata={(event) => applyStoredVolume(event.currentTarget)}
            />
          ) : (
            <AudioPreviewEditor asset={asset} playerId={`${asset.id}:quick-look`} autoPlay />
          )}
        </div>
        <footer>
          <span>
            {kind(asset.kind)} · {asset.extension.replace('.', '').toUpperCase()} ·{' '}
            {asset.durationMs
              ? `${(asset.durationMs / 1000).toFixed(1)}s`
              : t('quick.unknownDuration')}
          </span>
          {asset.mediaType === 'video' && asset.previewUrl ? (
            <div>
              <button
                type="button"
                className={!original ? 'active' : ''}
                onClick={() => setOriginal(false)}
              >
                {t('quick.context')}
              </button>
              <button
                type="button"
                className={original ? 'active' : ''}
                onClick={() => setOriginal(true)}
              >
                {t('quick.original')}
              </button>
            </div>
          ) : null}
        </footer>
      </section>
    </div>
  )
}
