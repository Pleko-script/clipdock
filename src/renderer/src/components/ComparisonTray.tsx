import { useEffect, useRef, useState, type DragEvent, type JSX, type KeyboardEvent } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripVertical,
  Pause,
  Play,
  Trash2,
  X
} from 'lucide-react'
import type { AssetSummary } from '../../../shared/clipdock'
import { assetCanDrag } from '../assetReadiness'
import {
  AUDIO_PREVIEW_VOLUME_KEY,
  claimAudioPreview,
  onOtherAudioPreview,
  storedPreviewVolume
} from '../audioPreview'
import { COMPARISON_SHORTLIST_LIMIT } from '../comparisonShortlist'
import { useI18n } from '../i18n'

export function ComparisonTray({
  assets,
  activeId,
  collapsed,
  onActiveChange,
  onRemove,
  onClear,
  onCollapsedChange,
  onDrag
}: {
  assets: AssetSummary[]
  activeId: string
  collapsed: boolean
  onActiveChange: (assetId: string) => void
  onRemove: (assetId: string) => void
  onClear: () => void
  onCollapsedChange: (collapsed: boolean) => void
  onDrag: (asset: AssetSummary, event: DragEvent<HTMLElement>) => void
}): JSX.Element {
  const { t } = useI18n()
  const audioRef = useRef<HTMLAudioElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const active = assets.find((asset) => asset.id === activeId) ?? assets[0]

  const changeActive = (assetId: string): void => {
    onActiveChange(assetId)
  }

  const move = (direction: -1 | 1): void => {
    const index = Math.max(
      0,
      assets.findIndex((asset) => asset.id === active.id)
    )
    changeActive(assets[(index + direction + assets.length) % assets.length].id)
  }

  useEffect(() => {
    const media = active.mediaType === 'audio' ? audioRef.current : videoRef.current
    audioRef.current?.pause()
    videoRef.current?.pause()
    if (!playing || collapsed || !media) return
    if (active.mediaType === 'audio') claimAudioPreview('comparison-tray')
    void media.play().catch(() => setPlaying(false))
  }, [active.id, active.mediaType, collapsed, playing])

  useEffect(
    () =>
      onOtherAudioPreview('comparison-tray', () => {
        audioRef.current?.pause()
        setPlaying(false)
      }),
    []
  )

  const handleKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      move(event.key === 'ArrowLeft' ? -1 : 1)
    } else if (event.key === ' ') {
      event.preventDefault()
      setPlaying((current) => !current)
    }
  }

  return (
    <aside
      className={`comparison-tray${collapsed ? ' collapsed' : ''}`}
      aria-label={t('compare.aria')}
      aria-keyshortcuts="ArrowLeft ArrowRight Space"
      tabIndex={0}
      onKeyDown={handleKey}
    >
      <header>
        <div>
          <strong>{t('compare.title')}</strong>
          <span className="comparison-count">
            {assets.length} / {COMPARISON_SHORTLIST_LIMIT}
          </span>
        </div>
        <div>
          {!collapsed ? (
            <button type="button" onClick={onClear} aria-label={t('compare.clear')}>
              <Trash2 size={14} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (!collapsed) setPlaying(false)
              onCollapsedChange(!collapsed)
            }}
            aria-label={t(collapsed ? 'compare.expand' : 'compare.collapse')}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </header>

      {!collapsed ? (
        <div className="comparison-body">
          <div className="comparison-candidates" aria-label={t('compare.candidates')}>
            {assets.map((asset) => (
              <div key={asset.id} className={asset.id === active.id ? 'active' : ''}>
                <button type="button" onClick={() => changeActive(asset.id)}>
                  {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" /> : <span />}
                  <strong>{asset.displayName}</strong>
                </button>
                <button
                  type="button"
                  aria-label={t('compare.remove', { name: asset.displayName })}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemove(asset.id)
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>

          <div className="comparison-player">
            <div
              className="comparison-media"
              draggable={assetCanDrag(active)}
              onDragStart={(event) => onDrag(active, event)}
            >
              {active.mediaType === 'video' ? (
                <video
                  ref={videoRef}
                  key={active.id}
                  src={active.previewUrl ?? active.mediaUrl}
                  poster={active.thumbnailUrl ?? undefined}
                  muted
                  loop
                  playsInline
                  onEnded={() => setPlaying(false)}
                />
              ) : (
                <>
                  {active.thumbnailUrl ? <img src={active.thumbnailUrl} alt="" /> : null}
                  <audio
                    ref={audioRef}
                    key={active.id}
                    src={active.mediaUrl}
                    onLoadedMetadata={(event) => {
                      event.currentTarget.volume = storedPreviewVolume(
                        window.localStorage.getItem(AUDIO_PREVIEW_VOLUME_KEY)
                      )
                    }}
                    onPlay={() => claimAudioPreview('comparison-tray')}
                    onEnded={() => setPlaying(false)}
                  />
                </>
              )}
            </div>
            <div className="comparison-transport">
              <button type="button" onClick={() => move(-1)} aria-label={t('compare.previous')}>
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                onClick={() => setPlaying((current) => !current)}
                aria-label={t(playing ? 'compare.pause' : 'compare.play')}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button type="button" onClick={() => move(1)} aria-label={t('compare.next')}>
                <ChevronRight size={15} />
              </button>
              <strong>{active.displayName}</strong>
              <span>{t('compare.keys')}</span>
              <span
                className="comparison-drag"
                draggable={assetCanDrag(active)}
                onDragStart={(event) => onDrag(active, event)}
                title={t('compare.drag')}
              >
                <GripVertical size={15} />
                {t('compare.drag')}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  )
}
