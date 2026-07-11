import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type JSX,
  type MouseEvent
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, AudioLines, Film, Heart, Layers3 } from 'lucide-react'
import type { AssetSummary } from '../../../shared/clipdock'

const GAP = 14

function durationLabel(durationMs: number | null): string {
  if (!durationMs) return '--:--'
  const seconds = Math.round(durationMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function formatLabel(asset: AssetSummary): string {
  const format = asset.extension.replace('.', '').toUpperCase()
  if (asset.mediaType === 'audio') {
    const sampleRate = asset.sampleRate ? `${Math.round(asset.sampleRate / 1000)} kHz` : null
    const channels = asset.channels === 1 ? 'Mono' : asset.channels === 2 ? 'Stereo' : null
    return [format, sampleRate, channels].filter(Boolean).join(' · ')
  }
  const codec = asset.codec
    ?.replace(/^h264$/i, 'H.264')
    .replace(/^hevc$/i, 'HEVC')
    .replace(/^prores$/i, 'ProRes')
  return [format, codec, asset.hasAlpha ? 'Alpha' : null].filter(Boolean).join(' · ')
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
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startHover = (): void => {
    hoverTimer.current = setTimeout(() => onPreview(true), asset.mediaType === 'audio' ? 300 : 250)
  }
  const stopHover = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    onPreview(false)
  }

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    },
    []
  )

  return (
    <article
      className={`asset-card${selected ? ' selected' : ''}${active ? ' active' : ''}${asset.status !== 'ready' ? ' unavailable' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      draggable={asset.status === 'ready'}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onOpen()
      }}
      onDragStart={onDrag}
      onMouseEnter={startHover}
      onMouseLeave={stopHover}
      title={asset.filePath}
    >
      <div className="asset-visual">
        {asset.thumbnailUrl ? (
          <img src={asset.thumbnailUrl} alt="" draggable={false} />
        ) : (
          <div className="asset-placeholder">
            <KindIcon asset={asset} />
          </div>
        )}
        {previewing && asset.mediaType === 'video' && (asset.previewUrl || asset.mediaUrl) ? (
          <video src={asset.previewUrl ?? asset.mediaUrl} autoPlay muted loop playsInline />
        ) : null}
        {previewing && asset.mediaType === 'audio' ? (
          <audio src={asset.mediaUrl} autoPlay onEnded={() => onPreview(false)} />
        ) : null}
        <div className="asset-card-topline">
          <span className={`asset-kind kind-${asset.kind}`}>
            <KindIcon asset={asset} />
            {asset.kind}
          </span>
          <button
            type="button"
            className={`favorite-icon${asset.favorite ? ' active' : ''}`}
            aria-label={asset.favorite ? 'Remove favorite' : 'Add favorite'}
            onClick={(event) => {
              event.stopPropagation()
              onFavorite()
            }}
          >
            <Heart size={16} fill={asset.favorite ? 'currentColor' : 'none'} />
          </button>
        </div>
        <div className="asset-card-badges">
          <span>{formatLabel(asset)}</span>
          <span>{durationLabel(asset.durationMs)}</span>
        </div>
        {asset.status !== 'ready' ? (
          <div className="asset-error">
            <AlertTriangle size={18} />
            Missing
          </div>
        ) : null}
        {asset.previewStatus === 'pending' ? (
          <span className="preview-pending">Building preview</span>
        ) : null}
      </div>
      <div className="asset-caption">
        <strong>{asset.displayName}</strong>
        <span>
          {asset.packName}
          {asset.categoryPath ? ` / ${asset.categoryPath}` : ''}
        </span>
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
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const virtualRows = virtualizer.getVirtualItems()
  const style = useMemo(() => ({ '--asset-columns': columns }) as CSSProperties, [columns])

  if (assets.length === 0) {
    return (
      <div className="asset-empty">
        <Film size={42} />
        <strong>No assets found</strong>
        <span>Add a pack or change the active filters.</span>
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
                    previewing
                      ? [
                          ...current.filter(
                            (id) =>
                              id !== asset.id &&
                              (asset.mediaType !== 'audio' ||
                                assets.find((item) => item.id === id)?.mediaType !== 'audio')
                          ),
                          asset.id
                        ].slice(-3)
                      : current.filter((id) => id !== asset.id)
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
