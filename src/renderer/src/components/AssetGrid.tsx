import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type JSX,
  type MouseEvent,
  type PointerEvent
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, AudioLines, Film, Heart, Layers3, Scissors } from 'lucide-react'
import type { AssetSummary } from '../../../shared/clipdock'
import { useI18n } from '../i18n'
import {
  AUDIO_HOVER_DELAY_MS,
  nextPreviewIds,
  pointerRatio,
  scrubTimeSeconds,
  VIDEO_HOVER_DELAY_MS
} from '../previewScrub'

const GAP = 14

function durationLabel(durationMs: number | null): string {
  if (!durationMs) return '--:--'
  const seconds = Math.round(durationMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function KindIcon({ asset }: { asset: AssetSummary }): JSX.Element {
  if (asset.kind === 'sound') return <AudioLines size={15} />
  if (asset.kind === 'overlay') return <Layers3 size={15} />
  return <Film size={15} />
}

function AssetCard({
  asset,
  selected,
  active,
  previewing,
  onSelect,
  onOpen,
  onDrag,
  onPreview,
  onFavorite
}: {
  asset: AssetSummary
  selected: boolean
  active: boolean
  previewing: boolean
  onSelect: (event: MouseEvent) => void
  onOpen: () => void
  onDrag: (event: DragEvent<HTMLElement>) => void
  onPreview: (active: boolean) => void
  onFavorite: () => void
}): JSX.Element {
  const { kind, t } = useI18n()
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seekFrame = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const onPreviewRef = useRef(onPreview)
  const scrubRatioRef = useRef(0.5)
  const [warming, setWarming] = useState(false)
  const [scrubRatio, setScrubRatio] = useState(0.5)

  useEffect(() => {
    onPreviewRef.current = onPreview
  }, [onPreview])

  const seekPreview = (ratio: number): void => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) return
    video.pause()
    video.currentTime = scrubTimeSeconds(ratio, video.duration)
  }

  const scheduleSeek = (ratio: number): void => {
    if (seekFrame.current !== null) cancelAnimationFrame(seekFrame.current)
    seekFrame.current = requestAnimationFrame(() => {
      seekFrame.current = null
      seekPreview(ratio)
    })
  }

  const updateScrubRatio = (ratio: number): void => {
    scrubRatioRef.current = ratio
    setScrubRatio(ratio)
  }

  const startPreview = (ratio: number): void => {
    if (asset.status !== 'ready') return
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    updateScrubRatio(ratio)
    if (asset.mediaType === 'video') setWarming(true)
    hoverTimer.current = setTimeout(
      () => {
        hoverTimer.current = null
        onPreviewRef.current(true)
        if (asset.mediaType === 'video') scheduleSeek(scrubRatioRef.current)
      },
      asset.mediaType === 'audio' ? AUDIO_HOVER_DELAY_MS : VIDEO_HOVER_DELAY_MS
    )
  }

  const stopPreview = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    if (seekFrame.current !== null) cancelAnimationFrame(seekFrame.current)
    seekFrame.current = null
    setWarming(false)
    onPreviewRef.current(false)
  }

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (seekFrame.current !== null) cancelAnimationFrame(seekFrame.current)
      onPreviewRef.current(false)
    },
    []
  )

  const pointerPosition = (event: PointerEvent<HTMLElement>): number => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return pointerRatio(event.clientX, bounds.left, bounds.width)
  }

  return (
    <article
      className={`asset-card${selected ? ' selected' : ''}${active ? ' active' : ''}${asset.status !== 'ready' ? ' unavailable' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-keyshortcuts="P Enter Space"
      draggable={asset.status === 'ready'}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key.toLowerCase() === 'p') {
          event.preventDefault()
          event.stopPropagation()
          if (previewing || hoverTimer.current) stopPreview()
          else startPreview(0.5)
          return
        }
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onOpen()
      }}
      onBlur={stopPreview}
      onDragStart={onDrag}
      onPointerEnter={(event) => startPreview(pointerPosition(event))}
      onPointerMove={(event) => {
        if (asset.mediaType !== 'video') return
        const ratio = pointerPosition(event)
        updateScrubRatio(ratio)
        if (previewing) scheduleSeek(ratio)
      }}
      onPointerLeave={stopPreview}
      title={asset.filePath}
    >
      <div className="asset-visual">
        {asset.posterUrl || asset.thumbnailUrl ? (
          <img src={asset.posterUrl ?? asset.thumbnailUrl ?? undefined} alt="" draggable={false} />
        ) : (
          <div className="asset-placeholder">
            <KindIcon asset={asset} />
          </div>
        )}
        {warming && asset.mediaType === 'video' && (asset.previewUrl || asset.mediaUrl) ? (
          <video
            ref={videoRef}
            className={previewing ? 'scrub-active' : 'scrub-warming'}
            src={asset.previewUrl ?? asset.mediaUrl}
            preload="auto"
            muted
            playsInline
            onLoadedMetadata={() => seekPreview(scrubRatioRef.current)}
          />
        ) : null}
        {previewing && asset.mediaType === 'video' ? (
          <span className="asset-scrub-position" style={{ left: `${scrubRatio * 100}%` }} />
        ) : null}
        {previewing && asset.mediaType === 'audio' ? (
          <audio src={asset.mediaUrl} autoPlay onEnded={() => onPreview(false)} />
        ) : null}
        <div className="asset-card-topline">
          {asset.kind !== 'unknown' ? (
            <span className="asset-kind">{kind(asset.kind)}</span>
          ) : (
            <span />
          )}
          <button
            type="button"
            className={`favorite-icon${asset.favorite ? ' active' : ''}`}
            aria-label={asset.favorite ? t('grid.removeFavorite') : t('grid.addFavorite')}
            onClick={(event) => {
              event.stopPropagation()
              onFavorite()
            }}
          >
            <Heart size={16} fill={asset.favorite ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="asset-card-badges">
          <span
            title={
              asset.trimStartMs !== null ? t('grid.selectedDuration') : t('grid.originalDuration')
            }
          >
            {asset.trimStartMs !== null && asset.trimEndMs !== null ? <Scissors size={10} /> : null}
            {durationLabel(
              asset.trimStartMs !== null && asset.trimEndMs !== null
                ? asset.trimEndMs - asset.trimStartMs
                : asset.durationMs
            )}
          </span>
        </div>
        {asset.status !== 'ready' ? (
          <div className="asset-error">
            <AlertTriangle size={18} />
            {t('grid.missing')}
          </div>
        ) : null}
        {asset.previewStatus === 'pending' ? (
          <span className="preview-pending">{t('grid.buildingPreview')}</span>
        ) : null}
      </div>
      <div className="asset-caption">
        <strong>{asset.displayName}</strong>
        <span>{asset.packName}</span>
      </div>
    </article>
  )
}

export function AssetGrid({
  assets,
  selectedIds,
  activeId,
  density,
  onSelect,
  onOpen,
  onDrag,
  onFavorite
}: {
  assets: AssetSummary[]
  selectedIds: Set<string>
  activeId: string | null
  density: number
  onSelect: (asset: AssetSummary, event: MouseEvent) => void
  onOpen: (asset: AssetSummary) => void
  onDrag: (asset: AssetSummary, event: DragEvent<HTMLElement>) => void
  onFavorite: (asset: AssetSummary) => void
}): JSX.Element {
  const { t } = useI18n()
  const parentRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [previewIds, setPreviewIds] = useState<string[]>([])
  const minimum = 170 + density * 36
  const columns = Math.max(1, Math.floor((width + GAP) / (minimum + GAP)))
  const rows = Math.ceil(assets.length / columns)
  const rowHeight = Math.round(minimum * 0.63 + 66 + GAP)
  // TanStack Virtual intentionally exposes mutable measurement functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 3
  })

  useEffect(() => {
    const element = parentRef.current
    if (!element) return
    const updateWidth = (): void => setWidth(element.getBoundingClientRect().width)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [assets.length])

  const virtualRows = virtualizer.getVirtualItems()
  const style = useMemo(() => ({ '--asset-columns': columns }) as CSSProperties, [columns])
  const mediaTypes = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset.mediaType])),
    [assets]
  )

  if (assets.length === 0) {
    return (
      <div className="asset-empty">
        <Film size={42} />
        <strong>{t('grid.emptyTitle')}</strong>
        <span>{t('grid.emptyBody')}</span>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="asset-grid-scroll">
      <div className="asset-grid-virtual" style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map((row) => (
          <div
            key={row.key}
            className="asset-grid-row"
            style={{ ...style, transform: `translateY(${row.start}px)`, height: rowHeight - GAP }}
          >
            {assets.slice(row.index * columns, row.index * columns + columns).map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                selected={selectedIds.has(asset.id)}
                active={activeId === asset.id}
                previewing={previewIds.includes(asset.id)}
                onSelect={(event) => onSelect(asset, event)}
                onOpen={() => onOpen(asset)}
                onDrag={(event) => onDrag(asset, event)}
                onFavorite={() => onFavorite(asset)}
                onPreview={(previewing) =>
                  setPreviewIds((current) =>
                    nextPreviewIds(current, asset.id, previewing, (id) => mediaTypes.get(id))
                  )
                }
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
