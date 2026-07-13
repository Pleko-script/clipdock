import {
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  type AssetAspect,
  type AssetAudioState,
  type AssetDragRequest,
  type AssetDurationBucket,
  type AssetKind,
  type AssetQuery,
  type AssetSortMode,
  type AssetStatus,
  type AssetTrimRequest,
  type AssetUpdateRequest,
  type OverlayMode,
  type PreviewStatus
} from '../shared/clipdock'

const KINDS = new Set<AssetKind>(['transition', 'overlay', 'sound', 'unknown'])
const OVERLAY_MODES = new Set<OverlayMode>(['alpha', 'screen', 'raw'])
const ASPECTS = new Set<AssetAspect>(['landscape', 'portrait', 'square', 'unknown'])
const DURATION_BUCKETS = new Set<AssetDurationBucket>([
  'under-1s',
  '1-3s',
  '3-10s',
  'over-10s',
  'unknown'
])
const AUDIO_STATES = new Set<AssetAudioState>(['with-audio', 'silent'])
const ASSET_STATUSES = new Set<AssetStatus>(['ready', 'missing', 'error'])
const PREVIEW_STATUSES = new Set<PreviewStatus>(['pending', 'ready', 'failed'])
const SORT_MODES = new Set<AssetSortMode>([
  'name',
  'modified',
  'duration',
  'last-used',
  'most-used'
])
const FORMATS = new Set<string>([...SUPPORTED_VIDEO_EXTENSIONS, ...SUPPORTED_AUDIO_EXTENSIONS])

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function strings(value: unknown, limit: number, length: number): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, length))
        .filter(Boolean)
    )
  ].slice(0, limit)
}

function enumStrings<T extends string>(value: unknown, allowed: ReadonlySet<T>, length = 32): T[] {
  return strings(value, allowed.size, length).filter((item): item is T => allowed.has(item as T))
}

export function validAssetIds(value: unknown, limit = 256): string[] {
  return strings(value, limit, 128)
}

export function validAssetId(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 128) : ''
}

export function validLabel(value: unknown, limit = 80): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : ''
}

export function parseAssetQuery(value: unknown): AssetQuery {
  const input = record(value)
  const kinds = enumStrings(input.kinds, KINDS, 16)
  const formats = strings(input.formats, FORMATS.size, 10)
    .map((format) => (format.startsWith('.') ? format : `.${format}`).toLowerCase())
    .filter((format) => FORMATS.has(format))
  const sort =
    typeof input.sort === 'string' && SORT_MODES.has(input.sort as AssetSortMode)
      ? (input.sort as AssetSortMode)
      : 'name'
  const cursor =
    typeof input.cursor === 'string' && /^\d{1,12}$/.test(input.cursor) ? input.cursor : undefined
  return {
    cursor,
    limit: Math.min(200, Math.max(1, Number(input.limit) || 200)),
    search: typeof input.search === 'string' ? input.search.trim().slice(0, 256) : undefined,
    kinds: kinds.length ? kinds : undefined,
    packIds: validAssetIds(input.packIds, 64),
    categoryPaths: strings(input.categoryPaths, 128, 512),
    aspects: enumStrings(input.aspects, ASPECTS),
    durationBuckets: enumStrings(input.durationBuckets, DURATION_BUCKETS),
    overlayModes: enumStrings(input.overlayModes, OVERLAY_MODES),
    audioStates: enumStrings(input.audioStates, AUDIO_STATES),
    collectionIds: validAssetIds(input.collectionIds, 64),
    tags: strings(input.tags, 32, 64),
    favoriteOnly: input.favoriteOnly === true,
    usedOnly: input.usedOnly === true,
    formats: formats.length ? formats : undefined,
    codecs: strings(input.codecs, 64, 64).map((codec) => codec.toLocaleLowerCase('en-US')),
    statuses: enumStrings(input.statuses, ASSET_STATUSES),
    previewStatuses: enumStrings(input.previewStatuses, PREVIEW_STATUSES),
    sort
  }
}

export function parseAssetUpdate(value: unknown): AssetUpdateRequest {
  const input = record(value)
  const kind =
    typeof input.kind === 'string' && KINDS.has(input.kind as AssetKind)
      ? (input.kind as AssetKind)
      : undefined
  const overlayMode =
    typeof input.overlayMode === 'string' && OVERLAY_MODES.has(input.overlayMode as OverlayMode)
      ? (input.overlayMode as OverlayMode)
      : undefined
  return {
    assetIds: validAssetIds(input.assetIds),
    kind,
    overlayMode,
    tags: Array.isArray(input.tags) ? strings(input.tags, 32, 64) : undefined,
    note: typeof input.note === 'string' ? input.note.slice(0, 4000) : undefined
  }
}

export function parseAssetTrim(value: unknown): AssetTrimRequest {
  const input = record(value)
  const numberOrNull = (candidate: unknown): number | null => {
    const number = typeof candidate === 'number' ? candidate : Number.NaN
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null
  }
  return {
    assetId: validAssetId(input.assetId),
    startMs: numberOrNull(input.startMs),
    endMs: numberOrNull(input.endMs),
    rotationDegrees:
      input.rotationDegrees === 90 || input.rotationDegrees === 180 || input.rotationDegrees === 270
        ? input.rotationDegrees
        : 0
  }
}

export function parseAssetDragRequest(value: unknown): AssetDragRequest {
  return { assetIds: validAssetIds(record(value).assetIds, 32) }
}
