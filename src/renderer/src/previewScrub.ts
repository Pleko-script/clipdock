import type { AssetMediaType } from '../../shared/clipdock'

export const VIDEO_HOVER_DELAY_MS = 250
export const AUDIO_HOVER_DELAY_MS = 300
export const CACHED_PREVIEW_RESPONSE_BUDGET_MS = 150
export const MAX_ACTIVE_VIDEO_PREVIEWS = 3
export const MAX_ACTIVE_AUDIO_PREVIEWS = 1

export function pointerRatio(clientX: number, left: number, width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 0.5
  return Math.min(1, Math.max(0, (clientX - left) / width))
}

export function scrubTimeSeconds(ratio: number, durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  const clampedRatio = Math.min(1, Math.max(0, ratio))
  const finalSeekableFrame = Math.max(0, durationSeconds - 1 / 30)
  return clampedRatio * finalSeekableFrame
}

export function nextPreviewIds(
  current: string[],
  assetId: string,
  active: boolean,
  mediaTypeForId: (id: string) => AssetMediaType | undefined
): string[] {
  const withoutAsset = current.filter((id) => id !== assetId)
  if (!active) return withoutAsset

  const queued = [...withoutAsset, assetId]
  const videos = queued
    .filter((id) => mediaTypeForId(id) === 'video')
    .slice(-MAX_ACTIVE_VIDEO_PREVIEWS)
  const audio = queued
    .filter((id) => mediaTypeForId(id) === 'audio')
    .slice(-MAX_ACTIVE_AUDIO_PREVIEWS)
  const allowed = new Set([...videos, ...audio])
  return queued.filter((id) => allowed.has(id))
}
