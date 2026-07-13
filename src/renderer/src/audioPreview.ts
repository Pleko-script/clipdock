export interface AudioLoopRange {
  startMs: number
  endMs: number
}

export const AUDIO_PREVIEW_CLAIM_EVENT = 'clipdock:audio-preview-claim'
export const AUDIO_PREVIEW_VOLUME_KEY = 'clipdock.previewVolume'
export const MIN_AUDIO_LOOP_MS = 50

export function clampAudioTime(milliseconds: number, durationMs: number): number {
  if (!Number.isFinite(milliseconds)) return 0
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
  return Math.min(duration, Math.max(0, Math.round(milliseconds)))
}

export function audioTimeFromPointer(
  clientX: number,
  left: number,
  width: number,
  durationMs: number
): number {
  if (width <= 0 || durationMs <= 0) return 0
  return clampAudioTime(((clientX - left) / width) * durationMs, durationMs)
}

export function normalizeAudioLoop(
  startMs: number,
  endMs: number,
  durationMs: number
): AudioLoopRange {
  const duration = Math.max(MIN_AUDIO_LOOP_MS, Math.round(durationMs))
  const start = Math.min(clampAudioTime(startMs, duration), duration - MIN_AUDIO_LOOP_MS)
  const end = Math.max(start + MIN_AUDIO_LOOP_MS, clampAudioTime(endMs, duration))
  return { startMs: start, endMs: Math.min(duration, end) }
}

export function loopedAudioTime(
  currentMs: number,
  loop: AudioLoopRange | null,
  loopEnabled: boolean
): number | null {
  if (!loopEnabled || !loop || currentMs < loop.endMs) return null
  return loop.startMs
}

export function storedPreviewVolume(value: string | null): number {
  const parsed = value === null ? Number.NaN : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.75
}

export function claimAudioPreview(playerId: string): void {
  window.dispatchEvent(
    new CustomEvent<{ playerId: string }>(AUDIO_PREVIEW_CLAIM_EVENT, {
      detail: { playerId }
    })
  )
}

export function onOtherAudioPreview(playerId: string, pause: () => void): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<{ playerId?: string }>).detail
    if (detail?.playerId && detail.playerId !== playerId) pause()
  }
  window.addEventListener(AUDIO_PREVIEW_CLAIM_EVENT, listener)
  return () => window.removeEventListener(AUDIO_PREVIEW_CLAIM_EVENT, listener)
}
