import { useState, type JSX } from 'react'
import { FolderSearch, RefreshCw, X } from 'lucide-react'
import type {
  AssetKind,
  AssetPosterRequest,
  AssetSummary,
  AssetTrimRequest,
  AssetUpdateRequest,
  ClipdockResult,
  OverlayMode
} from '../../../shared/clipdock'
import { useI18n } from '../i18n'
import { AssetTrimEditor } from './AssetTrimEditor'

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
  onSetTrim,
  onSetPoster,
  onReveal,
  onRegenerate
}: {
  assets: AssetSummary[]
  onClose: () => void
  onUpdate: (request: AssetUpdateRequest) => void
  onSetTrim: (request: AssetTrimRequest) => Promise<ClipdockResult<void>>
  onSetPoster: (request: AssetPosterRequest) => Promise<ClipdockResult<void>>
  onReveal: (asset: AssetSummary) => void
  onRegenerate: (assets: AssetSummary[]) => void
}): JSX.Element {
  const { kind, t } = useI18n()
  const primary = assets[0]
  const [tags, setTags] = useState(primary?.tags.join(', ') ?? '')
  const [tagsDirty, setTagsDirty] = useState(false)

  if (!primary)
    return (
      <aside className="asset-inspector empty">
        <button type="button" onClick={onClose} aria-label={t('inspector.close')}>
          <X size={17} />
        </button>
        <strong>{t('inspector.nothingSelected')}</strong>
        <p>{t('inspector.chooseClip')}</p>
      </aside>
    )

  const ids = assets.map((asset) => asset.id)
  return (
    <aside className="asset-inspector">
      <header>
        <div>
          <span>
            {assets.length > 1
              ? t('inspector.selected', { count: assets.length })
              : `${kind(primary.kind)} · ${primary.extension.replace('.', '').toUpperCase()}`}
          </span>
          <strong>{assets.length > 1 ? t('inspector.batchEdit') : primary.displayName}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label={t('inspector.close')}>
          <X size={17} />
        </button>
      </header>

      <div className="asset-editor-layout">
        <section className="inspector-side-panel inspector-organize">
          <h3>{t('inspector.organize')}</h3>
          <label>
            {t('inspector.assetType')}
            <select
              value={assets.every((asset) => asset.kind === primary.kind) ? primary.kind : ''}
              onChange={(event) =>
                event.target.value &&
                onUpdate({ assetIds: ids, kind: event.target.value as AssetKind })
              }
            >
              <option value="">{t('inspector.mixed')}</option>
              <option value="transition">{kind('transition')}</option>
              <option value="overlay">{kind('overlay')}</option>
              <option value="sound">{kind('sound')}</option>
              <option value="unknown">{kind('unknown')}</option>
            </select>
          </label>
          {assets.every((asset) => asset.kind === 'overlay') ? (
            <label>
              {t('inspector.overlayMode')}
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
                <option value="">{t('inspector.mixed')}</option>
                <option value="raw">{t('inspector.rawVideo')}</option>
                <option value="alpha">{t('inspector.alpha')}</option>
                <option value="screen">{t('inspector.screenAdd')}</option>
              </select>
            </label>
          ) : null}
          <label>
            {t('inspector.tags')}
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
              placeholder={t('inspector.tagsPlaceholder')}
            />
          </label>
        </section>

        <div className="asset-editor-primary">
          {assets.length === 1 && (primary.mediaType !== 'video' || !primary.durationMs) ? (
            <div className="inspector-preview">
              {primary.posterUrl || primary.thumbnailUrl ? (
                <img src={primary.posterUrl ?? primary.thumbnailUrl ?? undefined} alt="" />
              ) : null}
            </div>
          ) : null}
          {assets.length === 1 && primary.mediaType === 'video' && primary.durationMs ? (
            <AssetTrimEditor
              key={`${primary.id}:${primary.trimStartMs}:${primary.trimEndMs}:${primary.rotationDegrees}:${primary.trimStatus}:${primary.posterFrameMs}`}
              asset={primary}
              onSetTrim={onSetTrim}
              onSetPoster={onSetPoster}
            />
          ) : null}
        </div>

        <section className="inspector-side-panel inspector-file-panel">
          <h3>{t('inspector.fileDetails')}</h3>
          {assets.length === 1 ? (
            <>
              <dl className="asset-facts">
                <div>
                  <dt>{t('inspector.pack')}</dt>
                  <dd>{primary.packName}</dd>
                </div>
                <div>
                  <dt>{t('inspector.codec')}</dt>
                  <dd>{primary.codec ?? primary.audioCodec ?? t('inspector.unknown')}</dd>
                </div>
                <div>
                  <dt>{t('inspector.size')}</dt>
                  <dd>{bytes(primary.sizeBytes)}</dd>
                </div>
                {primary.widthPixels ? (
                  <div>
                    <dt>{t('inspector.frame')}</dt>
                    <dd>
                      {primary.widthPixels} × {primary.heightPixels}
                    </dd>
                  </div>
                ) : null}
                {primary.sampleRate ? (
                  <div>
                    <dt>{t('inspector.audio')}</dt>
                    <dd>
                      {primary.sampleRate} Hz · {primary.channels ?? '?'} ch
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t('inspector.compatibility')}</dt>
                  <dd className={`compatibility ${primary.compatibility}`}>
                    {t(`compat.${primary.compatibility}`)}
                  </dd>
                </div>
              </dl>
              {primary.kind === 'overlay' && primary.overlayMode === 'screen' ? (
                <p className="inspector-usage">{t('inspector.screenHint')}</p>
              ) : null}
              <div className="inspector-actions">
                <button type="button" onClick={() => onReveal(primary)}>
                  <FolderSearch size={15} />
                  {t('inspector.reveal')}
                </button>
                <button type="button" onClick={() => onRegenerate(assets)}>
                  <RefreshCw size={15} />
                  {t('inspector.rebuild')}
                </button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </aside>
  )
}
