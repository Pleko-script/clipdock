import type { DragEvent, JSX } from 'react'
import { CopyCheck, Eye, EyeOff, FolderOpen } from 'lucide-react'
import type { AssetSummary } from '../../../shared/clipdock'
import { assetCanDrag } from '../assetReadiness'
import { useI18n } from '../i18n'

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function DuplicateReview({
  assets,
  activeId,
  onSelect,
  onOpen,
  onDrag,
  onReveal,
  onSetHidden
}: {
  assets: AssetSummary[]
  activeId: string | null
  onSelect: (asset: AssetSummary) => void
  onOpen: (asset: AssetSummary) => void
  onDrag: (asset: AssetSummary, event: DragEvent<HTMLElement>) => void
  onReveal: (asset: AssetSummary) => void
  onSetHidden: (asset: AssetSummary, hidden: boolean) => void
}): JSX.Element {
  const { t } = useI18n()
  const groups = new Map<string, AssetSummary[]>()
  for (const asset of assets) {
    if (!asset.contentHash) continue
    groups.set(asset.contentHash, [...(groups.get(asset.contentHash) ?? []), asset])
  }

  if (!groups.size)
    return (
      <div className="duplicate-empty">
        <CopyCheck size={28} />
        <strong>{t('duplicates.emptyTitle')}</strong>
        <span>{t('duplicates.emptyBody')}</span>
      </div>
    )

  return (
    <div className="duplicate-review" aria-label={t('duplicates.review')}>
      {[...groups.entries()].map(([hash, items], groupIndex) => (
        <section className="duplicate-group" key={hash}>
          <header>
            <span>{t('duplicates.group', { number: groupIndex + 1 })}</span>
            <em>
              {t('duplicates.copies', { count: items[0].duplicateCount })} ·{' '}
              {fileSize(items[0].sizeBytes)}
            </em>
          </header>
          <div>
            {items.map((asset) => (
              <article
                key={asset.id}
                className={`${activeId === asset.id ? 'active' : ''}${asset.duplicateHidden ? ' hidden-copy' : ''}`}
                tabIndex={0}
                draggable={assetCanDrag(asset)}
                onClick={() => onSelect(asset)}
                onDoubleClick={() => onOpen(asset)}
                onDragStart={(event) => onDrag(asset, event)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onOpen(asset)
                }}
              >
                <div className="duplicate-thumb">
                  {asset.posterUrl || asset.thumbnailUrl ? (
                    <img src={asset.posterUrl ?? asset.thumbnailUrl ?? undefined} alt="" />
                  ) : (
                    <CopyCheck size={18} />
                  )}
                </div>
                <div className="duplicate-source">
                  <strong>{asset.displayName}</strong>
                  <span>
                    {asset.packName} · {asset.relativePath}
                  </span>
                  <code title={asset.filePath}>{asset.filePath}</code>
                </div>
                {asset.duplicateHidden ? <em>{t('duplicates.hidden')}</em> : null}
                <button
                  type="button"
                  title={t('duplicates.reveal')}
                  aria-label={t('duplicates.revealNamed', { name: asset.displayName })}
                  onClick={(event) => {
                    event.stopPropagation()
                    onReveal(asset)
                  }}
                >
                  <FolderOpen size={15} />
                </button>
                <button
                  type="button"
                  title={t(asset.duplicateHidden ? 'duplicates.show' : 'duplicates.hide')}
                  aria-label={t(
                    asset.duplicateHidden ? 'duplicates.showNamed' : 'duplicates.hideNamed',
                    { name: asset.displayName }
                  )}
                  onClick={(event) => {
                    event.stopPropagation()
                    onSetHidden(asset, !asset.duplicateHidden)
                  }}
                >
                  {asset.duplicateHidden ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
