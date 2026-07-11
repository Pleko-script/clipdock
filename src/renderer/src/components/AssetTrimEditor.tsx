import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import {
  Check,
  CircleAlert,
  LoaderCircle,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scissors,
  Volume2,
  VolumeX
} from 'lucide-react'
import {
  MIN_VIDEO_TRIM_MS,
  type AssetSummary,
  type AssetTrimRequest,
  type ClipdockResult,
  type VideoRotation
} from '../../../shared/clipdock'
import { useI18n } from '../i18n'

function timecode(milliseconds: number): string {
  const total = Math.max(0, milliseconds)
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = Math.floor(total % 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

export function AssetTrimEditor({
  asset,
  onSetTrim
}: {
  asset: AssetSummary
  onSetTrim: (request: AssetTrimRequest) => Promise<ClipdockResult<void>>
}): JSX.Element {
  const { error: localizeError, t } = useI18n()
  const duration = Math.max(MIN_VIDEO_TRIM_MS, Math.round(asset.durationMs ?? 0))
  const frameStep = Math.min(duration, Math.max(1, Math.round(1000 / (asset.fps || 25))))
  const minimumRange = Math.min(duration, Math.max(MIN_VIDEO_TRIM_MS, frameStep))
  const persistedStart = asset.trimStartMs ?? 0
  const persistedEnd = asset.trimEndMs ?? duration
  const savedStart = Math.min(Math.max(0, persistedStart), duration - minimumRange)
  const savedEnd = Math.max(savedStart + minimumRange, Math.min(duration, persistedEnd))
  const [startMs, setStartMs] = useState(savedStart)
  const [endMs, setEndMs] = useState(savedEnd)
  const [currentMs, setCurrentMs] = useState(savedStart)
  const [playing, setPlaying] = useState(false)
  const savedRotation: VideoRotation = [90, 180, 270].includes(asset.rotationDegrees)
    ? asset.rotationDegrees
    : 0
  const [rotationDegrees, setRotationDegrees] = useState<VideoRotation>(savedRotation)
  const [volume, setVolume] = useState(() => {
    const value = window.localStorage.getItem('clipdock.previewVolume')
    const stored = value === null ? Number.NaN : Number(value)
    return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.75
  })
  const [muted, setMuted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasSavedRange = asset.trimStartMs !== null && asset.trimEndMs !== null
  const hasSavedEdit = hasSavedRange || savedRotation !== 0
  const rangeChanged = startMs !== persistedStart || endMs !== persistedEnd
  const rotationChanged = rotationDegrees !== savedRotation
  const editChanged = rangeChanged || rotationChanged
  const needsBuild = hasSavedEdit && asset.trimStatus !== 'ready'
  const selectedDuration = endMs - startMs
  const selectionPercent = Math.round((selectedDuration / duration) * 100)
  const hasAudio = Boolean(asset.audioCodec || asset.sampleRate || asset.channels)
  const state = saving
    ? { icon: <LoaderCircle className="spin" size={12} />, label: t('trim.rendering') }
    : asset.trimStatus === 'ready'
      ? { icon: <Check size={12} />, label: t('trim.ready') }
      : asset.trimStatus === 'failed'
        ? { icon: <CircleAlert size={12} />, label: t('trim.failed') }
        : asset.trimStatus === 'pending'
          ? { icon: <CircleAlert size={12} />, label: t('trim.rebuild') }
          : { icon: <span className="trim-status-dot" />, label: t('trim.original') }
  const rangeStyle = {
    '--trim-start': `${(startMs / duration) * 100}%`,
    '--trim-end': `${(endMs / duration) * 100}%`
  } as CSSProperties

  useEffect(() => {
    window.localStorage.setItem('clipdock.previewVolume', String(volume))
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted
  }, [muted, volume])

  const seek = (milliseconds: number): void => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = milliseconds / 1000
    setCurrentMs(milliseconds)
  }

  const save = async (request: AssetTrimRequest): Promise<void> => {
    setSaving(true)
    setError(null)
    const result = await onSetTrim(request)
    setSaving(false)
    if (!result.ok) setError(localizeError(result.error.message))
  }

  const preparedRequest = (): AssetTrimRequest => {
    const usesFullRange = startMs === 0 && endMs === duration
    return {
      assetId: asset.id,
      startMs: usesFullRange ? null : startMs,
      endMs: usesFullRange ? null : endMs,
      rotationDegrees
    }
  }

  const rotate = (direction: -1 | 1): void => {
    setRotationDegrees((current) => {
      const next = (current + direction * 90 + 360) % 360
      return next as VideoRotation
    })
  }

  const playRange = (): void => {
    const video = videoRef.current
    if (!video) return
    if (!video.paused) {
      video.pause()
      return
    }
    if (currentMs < startMs || currentMs >= endMs) {
      video.currentTime = startMs / 1000
      setCurrentMs(startMs)
    }
    void video.play().catch(() => undefined)
  }

  const updateHandle = (handle: 'in' | 'out', value: number): void => {
    const snapped = Math.round(value / frameStep) * frameStep
    if (handle === 'in') {
      const next = Math.min(Math.max(0, snapped), endMs - minimumRange)
      setStartMs(next)
      seek(next)
      return
    }
    const next = Math.max(startMs + minimumRange, Math.min(duration, snapped))
    setEndMs(next)
    seek(Math.max(startMs, next - frameStep))
  }

  const updateHandleFromPointer = (
    handle: 'in' | 'out',
    event: PointerEvent<HTMLButtonElement>
  ): void => {
    const rail = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rail?.width) return
    updateHandle(handle, ((event.clientX - rail.left) / rail.width) * duration)
  }

  const handleSliderKey = (
    handle: 'in' | 'out',
    current: number,
    event: KeyboardEvent<HTMLButtonElement>
  ): void => {
    const directions: Record<string, number> = {
      ArrowLeft: -frameStep,
      ArrowDown: -frameStep,
      ArrowRight: frameStep,
      ArrowUp: frameStep,
      PageDown: -frameStep * 10,
      PageUp: frameStep * 10
    }
    if (event.key === 'Home') {
      event.preventDefault()
      updateHandle(handle, handle === 'in' ? 0 : startMs + minimumRange)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      updateHandle(handle, handle === 'in' ? endMs - minimumRange : duration)
      return
    }
    const delta = directions[event.key]
    if (!delta) return
    event.preventDefault()
    updateHandle(handle, current + delta)
  }

  const releasePointer = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <section className="trim-editor" aria-label={t('trim.aria')}>
      <header className="trim-editor-header">
        <div>
          <strong>{t('trim.clipRange')}</strong>
          <span>{t('trim.nonDestructive')}</span>
        </div>
        <span className={`trim-status ${asset.trimStatus}`}>
          {state.icon}
          {state.label}
        </span>
      </header>

      <div className="trim-media-stage">
        <video
          ref={videoRef}
          src={asset.mediaUrl}
          poster={asset.thumbnailUrl ?? undefined}
          preload="metadata"
          style={{ transform: `rotate(${rotationDegrees}deg)` }}
          onClick={playRange}
          onDoubleClick={() => void videoRef.current?.requestFullscreen()}
          onLoadedMetadata={(event) => {
            event.currentTarget.volume = volume
            event.currentTarget.muted = muted
            seek(startMs)
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            const milliseconds = event.currentTarget.currentTime * 1000
            if (milliseconds < endMs) {
              setCurrentMs(milliseconds)
              return
            }
            event.currentTarget.currentTime = startMs / 1000
            setCurrentMs(startMs)
          }}
        />
      </div>
      <div className="trim-player-controls">
        <button
          type="button"
          onClick={playRange}
          aria-label={playing ? t('trim.pause') : t('trim.play')}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <output>{timecode(currentMs)}</output>
        <span>/</span>
        <span>{timecode(duration)}</span>
        <span className="trim-player-spacer" />
        <button type="button" onClick={() => rotate(-1)} aria-label={t('trim.rotateLeft')}>
          <RotateCcw size={14} />
        </button>
        <output className="trim-rotation-value">{rotationDegrees}°</output>
        <button type="button" onClick={() => rotate(1)} aria-label={t('trim.rotateRight')}>
          <RotateCw size={14} />
        </button>
        <button
          type="button"
          onClick={() => void videoRef.current?.requestFullscreen()}
          aria-label={t('trim.fullscreen')}
        >
          <Maximize2 size={14} />
        </button>
      </div>

      <div className="trim-range-panel">
        <div className={`trim-volume-control${hasAudio ? '' : ' unavailable'}`}>
          <button
            type="button"
            disabled={!hasAudio}
            onClick={() => setMuted((current) => !current)}
            aria-label={muted ? t('trim.unmute') : t('trim.mute')}
          >
            {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            disabled={!hasAudio}
            onChange={(event) => {
              const nextVolume = Number(event.target.value)
              setVolume(nextVolume)
              if (nextVolume > 0) setMuted(false)
            }}
            aria-label={t('trim.volume')}
          />
          <output>
            {hasAudio ? `${Math.round((muted ? 0 : volume) * 100)}%` : t('trim.noAudio')}
          </output>
        </div>
        <div className="trim-range-values">
          <label id={`trim-in-${asset.id}`}>
            <span>{t('trim.in')}</span>
            <output>{timecode(startMs)}</output>
          </label>
          <button type="button" onClick={playRange} aria-label={t('trim.previewRange')}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <label id={`trim-out-${asset.id}`}>
            <span>{t('trim.out')}</span>
            <output>{timecode(endMs)}</output>
          </label>
        </div>

        <div className="trim-range" style={rangeStyle}>
          <span className="trim-range-rail" />
          <span className="trim-range-selection" />
          <button
            className="trim-range-thumb in"
            type="button"
            role="slider"
            aria-labelledby={`trim-in-${asset.id}`}
            aria-valuemin={0}
            aria-valuemax={Math.max(0, endMs - minimumRange)}
            aria-valuenow={startMs}
            aria-valuetext={timecode(startMs)}
            onKeyDown={(event) => handleSliderKey('in', startMs, event)}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              updateHandleFromPointer('in', event)
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                updateHandleFromPointer('in', event)
            }}
            onPointerUp={releasePointer}
            onPointerCancel={releasePointer}
          />
          <button
            className="trim-range-thumb out"
            type="button"
            role="slider"
            aria-labelledby={`trim-out-${asset.id}`}
            aria-valuemin={Math.min(duration, startMs + minimumRange)}
            aria-valuemax={duration}
            aria-valuenow={endMs}
            aria-valuetext={timecode(endMs)}
            onKeyDown={(event) => handleSliderKey('out', endMs, event)}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              updateHandleFromPointer('out', event)
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                updateHandleFromPointer('out', event)
            }}
            onPointerUp={releasePointer}
            onPointerCancel={releasePointer}
          />
        </div>

        <div className="trim-range-summary">
          <strong>{timecode(selectedDuration)}</strong>
          <span>{t('trim.sourcePercent', { percent: selectionPercent })}</span>
        </div>
      </div>

      {error || asset.trimErrorMessage ? (
        <p className="trim-error">{error ?? asset.trimErrorMessage}</p>
      ) : null}

      <footer className="trim-actions">
        {editChanged || needsBuild ? (
          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={() => void save(preparedRequest())}
          >
            <Scissors size={14} />
            {saving
              ? t('trim.renderingAction')
              : hasSavedEdit
                ? t('trim.updateVideo')
                : t('trim.prepareVideo')}
          </button>
        ) : (
          <span>{hasSavedEdit ? t('trim.dragPrepared') : t('trim.editPrompt')}</span>
        )}
        {hasSavedEdit ? (
          <button
            type="button"
            aria-label={t('trim.reset')}
            title={t('trim.resetTitle')}
            disabled={saving}
            onClick={() =>
              void save({ assetId: asset.id, startMs: null, endMs: null, rotationDegrees: 0 })
            }
          >
            <RotateCcw size={14} />
          </button>
        ) : null}
      </footer>
    </section>
  )
}
