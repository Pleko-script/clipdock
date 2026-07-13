import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import {
  FolderSearch,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  X
} from 'lucide-react'
import type {
  AssetKind,
  AssetPosterRequest,
  AssetSummary,
  AssetTrimRequest,
  AssetUpdateRequest,
  ClipdockResult,
  OverlayMode
} from '../../../shared/clipdock'
import {
  EDITOR_PANEL_COLLAPSED_WIDTH,
  EDITOR_PANEL_STORAGE_KEY,
  parseEditorPanelLayout,
  responsivePanelCollapse,
  type EditorPanelLayout,
  type EditorPanelSide
} from '../editorPanelLayout'
import { useI18n } from '../i18n'
import { AssetTrimEditor } from './AssetTrimEditor'
import { PanelResizeHandle } from './PanelResizeHandle'

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
  const [panelLayout, setPanelLayout] = useState(() =>
    parseEditorPanelLayout(window.localStorage.getItem(EDITOR_PANEL_STORAGE_KEY))
  )
  const [editorWidth, setEditorWidth] = useState(1200)
  const editorLayoutRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.localStorage.setItem(EDITOR_PANEL_STORAGE_KEY, JSON.stringify(panelLayout))
  }, [panelLayout])

  useEffect(() => {
    const element = editorLayoutRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setEditorWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [primary?.id])

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
  const responsiveCollapse = responsivePanelCollapse(editorWidth)
  const organizeCollapsed = panelLayout.organizeCollapsed || responsiveCollapse.organize
  const detailsCollapsed = panelLayout.detailsCollapsed || responsiveCollapse.details
  const panelStyle = {
    '--organize-panel-width': `${organizeCollapsed ? EDITOR_PANEL_COLLAPSED_WIDTH : panelLayout.organizeWidth}px`,
    '--details-panel-width': `${detailsCollapsed ? EDITOR_PANEL_COLLAPSED_WIDTH : panelLayout.detailsWidth}px`,
    '--organize-resizer-width': organizeCollapsed ? '0px' : '10px',
    '--details-resizer-width': detailsCollapsed ? '0px' : '10px'
  } as CSSProperties

  const setPanelWidth = (side: EditorPanelSide, width: number): void => {
    setPanelLayout((current) => ({
      ...current,
      [side === 'organize' ? 'organizeWidth' : 'detailsWidth']: width
    }))
  }

  const togglePanel = (side: EditorPanelSide): void => {
    const key: keyof Pick<EditorPanelLayout, 'organizeCollapsed' | 'detailsCollapsed'> =
      side === 'organize' ? 'organizeCollapsed' : 'detailsCollapsed'
    setPanelLayout((current) => ({ ...current, [key]: !current[key] }))
  }

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

      <div ref={editorLayoutRef} className="asset-editor-layout" style={panelStyle}>
        <section
          className={`inspector-side-panel inspector-organize${organizeCollapsed ? ' collapsed' : ''}`}
        >
          <div className="inspector-panel-header">
            <h3>{t('inspector.organize')}</h3>
            <button
              type="button"
              aria-label={
                organizeCollapsed ? t('inspector.expandOrganize') : t('inspector.collapseOrganize')
              }
              aria-expanded={!organizeCollapsed}
              aria-controls="inspector-organize-content"
              disabled={responsiveCollapse.organize}
              title={responsiveCollapse.organize ? t('inspector.expandWindow') : undefined}
              onClick={() => togglePanel('organize')}
            >
              {organizeCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          </div>
          {!organizeCollapsed ? (
            <div id="inspector-organize-content" className="inspector-panel-content">
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
                      onUpdate({
                        assetIds: ids,
                        overlayMode: event.target.value as OverlayMode
                      })
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
            </div>
          ) : null}
        </section>

        <PanelResizeHandle
          side="organize"
          width={panelLayout.organizeWidth}
          label={t('inspector.resizeOrganize')}
          hidden={organizeCollapsed}
          onResize={(width) => setPanelWidth('organize', width)}
        />

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

        <PanelResizeHandle
          side="details"
          width={panelLayout.detailsWidth}
          label={t('inspector.resizeDetails')}
          hidden={detailsCollapsed}
          onResize={(width) => setPanelWidth('details', width)}
        />

        <section
          className={`inspector-side-panel inspector-file-panel${detailsCollapsed ? ' collapsed' : ''}`}
        >
          <div className="inspector-panel-header">
            <h3>{t('inspector.fileDetails')}</h3>
            <button
              type="button"
              aria-label={
                detailsCollapsed ? t('inspector.expandDetails') : t('inspector.collapseDetails')
              }
              aria-expanded={!detailsCollapsed}
              aria-controls="inspector-file-content"
              disabled={responsiveCollapse.details}
              title={responsiveCollapse.details ? t('inspector.expandWindow') : undefined}
              onClick={() => togglePanel('details')}
            >
              {detailsCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
            </button>
          </div>
          {!detailsCollapsed && assets.length === 1 ? (
            <div id="inspector-file-content" className="inspector-panel-content">
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
            </div>
          ) : null}
        </section>
      </div>
    </aside>
  )
}
