import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { countAssetFilters } from '../../../shared/assetFilters'
import type {
  AssetFacetOption,
  AssetFacets,
  AssetFilterField,
  AssetFilterSelection,
  AssetKind
} from '../../../shared/clipdock'
import { useI18n } from '../i18n'

const FACET_GROUPS = [
  { field: 'kinds', facet: 'kinds', title: 'filter.kinds' },
  { field: 'packIds', facet: 'packs', title: 'filter.packs' },
  { field: 'categoryPaths', facet: 'categories', title: 'filter.categories' },
  { field: 'aspects', facet: 'aspects', title: 'filter.aspect' },
  { field: 'durationBuckets', facet: 'durations', title: 'filter.duration' },
  { field: 'overlayModes', facet: 'overlayModes', title: 'filter.overlayMode' },
  { field: 'audioStates', facet: 'audioStates', title: 'filter.audio' },
  { field: 'ucsCategories', facet: 'ucsCategories', title: 'filter.ucsCategory' },
  { field: 'formats', facet: 'formats', title: 'filter.format' },
  { field: 'codecs', facet: 'codecs', title: 'filter.codec' },
  { field: 'statuses', facet: 'statuses', title: 'filter.assetStatus' },
  { field: 'previewStatuses', facet: 'previewStatuses', title: 'filter.previewStatus' }
] as const

type FacetGroup = (typeof FACET_GROUPS)[number]

function optionLabel(
  field: AssetFilterField,
  option: AssetFacetOption,
  kind: (value: AssetKind) => string,
  t: ReturnType<typeof useI18n>['t']
): string {
  const value = option.value
  if (field === 'kinds') return kind(value as AssetKind)
  if (field === 'packIds') return option.label || value
  if (field === 'categoryPaths') return value || t('filter.packRoot')
  if (field === 'aspects') {
    if (value === 'landscape') return t('filter.landscape')
    if (value === 'portrait') return t('filter.portrait')
    if (value === 'square') return t('filter.square')
    return t('filter.unknown')
  }
  if (field === 'durationBuckets') {
    if (value === 'under-1s') return t('filter.underOneSecond')
    if (value === '1-3s') return t('filter.oneToThreeSeconds')
    if (value === '3-10s') return t('filter.threeToTenSeconds')
    if (value === 'over-10s') return t('filter.overTenSeconds')
    return t('filter.unknown')
  }
  if (field === 'overlayModes') {
    if (value === 'alpha') return t('filter.alpha')
    if (value === 'screen') return t('filter.screen')
    return t('filter.raw')
  }
  if (field === 'audioStates')
    return value === 'with-audio' ? t('filter.withAudio') : t('filter.silent')
  if (field === 'ucsCategories') return option.label || value
  if (field === 'statuses') {
    if (value === 'ready') return t('filter.ready')
    if (value === 'missing') return t('filter.missing')
    return t('filter.error')
  }
  if (field === 'previewStatuses') {
    if (value === 'ready') return t('filter.previewReady')
    if (value === 'pending') return t('filter.previewPending')
    return t('filter.previewFailed')
  }
  return value.replace(/^\./, '').toLocaleUpperCase()
}

function groupOptions(
  group: FacetGroup,
  facets: AssetFacets,
  filters: AssetFilterSelection
): AssetFacetOption[] {
  const available = facets[group.facet]
  const selected = filters[group.field] as string[]
  return [
    ...available,
    ...selected
      .filter((value) => !available.some((option) => option.value === value))
      .map((value) => ({ value, count: 0 }))
  ]
}

export function AssetFilterPopover({
  facets,
  filters,
  onToggle,
  onClear
}: {
  facets: AssetFacets
  filters: AssetFilterSelection
  onToggle: (field: AssetFilterField, value: string) => void
  onClear: () => void
}): JSX.Element {
  const { kind, t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const count = countAssetFilters(filters)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeWithEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeWithEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeWithEscape)
    }
  }, [open])

  return (
    <div className="asset-filter-control" ref={rootRef}>
      <button
        type="button"
        className={open || count ? 'active' : ''}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t('filter.button')}
      >
        <SlidersHorizontal size={16} />
        {count ? <span className="asset-filter-count">{count}</span> : null}
      </button>
      {open ? (
        <section className="asset-filter-popover" role="dialog" aria-label={t('filter.title')}>
          <header>
            <strong>{t('filter.title')}</strong>
            <span>
              {count ? (
                <button type="button" className="filter-clear" onClick={onClear}>
                  {t('filter.clearAll')}
                </button>
              ) : null}
              <button
                type="button"
                className="filter-close"
                onClick={() => setOpen(false)}
                aria-label={t('filter.close')}
              >
                <X size={15} />
              </button>
            </span>
          </header>
          <div className="asset-filter-groups">
            {FACET_GROUPS.map((group) => {
              const options = groupOptions(group, facets, filters)
              return (
                <fieldset key={group.field}>
                  <legend>{t(group.title)}</legend>
                  {options.length ? (
                    options.map((option) => {
                      const selected = (filters[group.field] as string[]).includes(option.value)
                      return (
                        <label key={option.value || '__root'}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => onToggle(group.field, option.value)}
                          />
                          <span>{optionLabel(group.field, option, kind, t)}</span>
                          <em>{option.count}</em>
                        </label>
                      )
                    })
                  ) : (
                    <p>{t('filter.noOptions')}</p>
                  )}
                </fieldset>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function AssetFilterChips({
  facets,
  filters,
  onToggle,
  onClear
}: {
  facets: AssetFacets
  filters: AssetFilterSelection
  onToggle: (field: AssetFilterField, value: string) => void
  onClear: () => void
}): JSX.Element | null {
  const { kind, t } = useI18n()
  const chips = useMemo(
    () =>
      FACET_GROUPS.flatMap((group) =>
        (filters[group.field] as string[]).map((value) => {
          const option = facets[group.facet].find((item) => item.value === value) ?? {
            value,
            count: 0
          }
          return {
            field: group.field,
            value,
            label: optionLabel(group.field, option, kind, t)
          }
        })
      ),
    [facets, filters, kind, t]
  )
  if (!chips.length) return null
  return (
    <div className="asset-filter-chips" aria-label={t('filter.active')}>
      {chips.map((chip) => (
        <button
          type="button"
          key={`${chip.field}:${chip.value}`}
          onClick={() => onToggle(chip.field, chip.value)}
          aria-label={t('filter.remove', { name: chip.label })}
        >
          <span>{chip.label}</span>
          <X size={12} />
        </button>
      ))}
      <button type="button" className="filter-clear-chip" onClick={onClear}>
        {t('filter.clearAll')}
      </button>
    </div>
  )
}
