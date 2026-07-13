import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent
} from 'react'
import { AudioLines, CircleX, Pause, Play, Repeat2, ScanLine, Volume2, VolumeX } from 'lucide-react'
import type { AssetSummary } from '../../../shared/clipdock'
import {
  AUDIO_PREVIEW_VOLUME_KEY,
  audioTimeFromPointer,
  claimAudioPreview,
  clampAudioTime,
  loopedAudioTime,
  normalizeAudioLoop,
  onOtherAudioPreview,
  storedPreviewVolume,
  type AudioLoopRange
} from '../audioPreview'
import { useI18n } from '../i18n'

function timecode(milliseconds: number): string {
  const total = Number.isFinite(milliseconds) ? Math.max(0, Math.round(milliseconds)) : 0
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

export function AudioPreviewEditor({
  asset,
  playerId,
  autoPlay = false
}: {
  asset: AssetSummary
  playerId: string
  autoPlay?: boolean
}): JSX.Element {
  const { t } = useI18n()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [durationMs, setDurationMs] = useState(Math.max(1, asset.durationMs ?? 1))
  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState<AudioLoopRange | null>(null)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [spectrogram, setSpectrogram] = useState(false)
  const [volume, setVolume] = useState(() =>
    storedPreviewVolume(window.localStorage.getItem(AUDIO_PREVIEW_VOLUME_KEY))
  )
  const [muted, setMuted] = useState(false)

  const seek = (milliseconds: number): void => {
    const next = clampAudioTime(milliseconds, durationMs)
    if (audioRef.current) audioRef.current.currentTime = next / 1000
    setCurrentMs(next)
  }

  const pause = (): void => {
    audioRef.current?.pause()
    setPlaying(false)
  }

  const play = (): void => {
    const audio = audioRef.current
    if (!audio) return
    if (loopEnabled && loop && (currentMs < loop.startMs || currentMs >= loop.endMs)) {
      audio.currentTime = loop.startMs / 1000
      setCurrentMs(loop.startMs)
    }
    claimAudioPreview(playerId)
    void audio.play().catch(() => setPlaying(false))
  }

  const setLoopStart = (): void => {
    setLoop((current) => normalizeAudioLoop(currentMs, current?.endMs ?? durationMs, durationMs))
  }

  const setLoopEnd = (): void => {
    setLoop((current) => normalizeAudioLoop(current?.startMs ?? 0, currentMs, durationMs))
  }

  const clearLoop = (): void => {
    setLoop(null)
    setLoopEnabled(false)
  }

  useEffect(
    () =>
      onOtherAudioPreview(playerId, () => {
        audioRef.current?.pause()
        setPlaying(false)
      }),
    [playerId]
  )

  useEffect(() => {
    window.localStorage.setItem(AUDIO_PREVIEW_VOLUME_KEY, String(volume))
    if (!audioRef.current) return
    audioRef.current.volume = volume
    audioRef.current.muted = muted
  }, [muted, volume])

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    seek(audioTimeFromPointer(event.clientX, bounds.left, bounds.width, durationMs))
  }

  const handleKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === ' ') {
      event.preventDefault()
      if (playing) pause()
      else play()
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      seek(event.key === 'Home' ? 0 : durationMs)
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const step = event.shiftKey ? 5_000 : Math.max(100, Math.round(durationMs / 100))
      seek(currentMs + (event.key === 'ArrowLeft' ? -step : step))
      return
    }
    if (event.key.toLowerCase() === 'i') {
      event.preventDefault()
      setLoopStart()
      return
    }
    if (event.key.toLowerCase() === 'o') {
      event.preventDefault()
      setLoopEnd()
      return
    }
    if (event.key.toLowerCase() === 'l' && loop) {
      event.preventDefault()
      setLoopEnabled((current) => !current)
    }
  }

  const style = {
    '--audio-playhead': `${(currentMs / durationMs) * 100}%`,
    '--audio-loop-start': `${((loop?.startMs ?? 0) / durationMs) * 100}%`,
    '--audio-loop-end': `${((loop?.endMs ?? 0) / durationMs) * 100}%`
  } as CSSProperties
  const image = spectrogram && asset.previewUrl ? asset.previewUrl : asset.thumbnailUrl

  return (
    <section className="audio-preview-editor" aria-label={t('audio.aria')}>
      <header>
        <strong>{t('audio.preview')}</strong>
        <div>
          <button
            type="button"
            className={!spectrogram ? 'active' : ''}
            onClick={() => setSpectrogram(false)}
          >
            <AudioLines size={13} />
            {t('audio.waveform')}
          </button>
          <button
            type="button"
            className={spectrogram ? 'active' : ''}
            disabled={!asset.previewUrl}
            title={!asset.previewUrl ? t('audio.spectrogramUnavailable') : undefined}
            onClick={() => setSpectrogram(true)}
          >
            <ScanLine size={13} />
            {t('audio.spectrogram')}
          </button>
        </div>
      </header>

      <div
        className="audio-waveform"
        role="slider"
        tabIndex={0}
        aria-label={t('audio.seek')}
        aria-valuemin={0}
        aria-valuemax={durationMs}
        aria-valuenow={currentMs}
        aria-valuetext={timecode(currentMs)}
        aria-keyshortcuts="Space ArrowLeft ArrowRight Home End I O L"
        style={style}
        onKeyDown={handleKey}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          seekFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
      >
        {image ? <img src={image} alt="" draggable={false} /> : <AudioLines size={34} />}
        {loop ? <span className="audio-loop-range" /> : null}
        <span className="audio-playhead" />
      </div>

      <div className="audio-transport">
        <button
          type="button"
          onClick={() => {
            if (playing) pause()
            else play()
          }}
          aria-label={t(playing ? 'audio.pause' : 'audio.play')}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <strong>{timecode(currentMs)}</strong>
        <span>/</span>
        <span>{timecode(durationMs)}</span>
        <button type="button" onClick={setLoopStart} aria-keyshortcuts="I">
          {t('audio.setIn')}
        </button>
        <button type="button" onClick={setLoopEnd} aria-keyshortcuts="O">
          {t('audio.setOut')}
        </button>
        <button
          type="button"
          className={loopEnabled ? 'active' : ''}
          disabled={!loop}
          aria-pressed={loopEnabled}
          aria-keyshortcuts="L"
          onClick={() => setLoopEnabled((current) => !current)}
        >
          <Repeat2 size={13} />
          {t('audio.loop')}
        </button>
        <button type="button" disabled={!loop} onClick={clearLoop}>
          <CircleX size={13} />
          {t('audio.clearLoop')}
        </button>
      </div>

      <div className="audio-loop-readout" aria-live="polite">
        <span>
          {t('audio.in')} <strong>{timecode(loop?.startMs ?? 0)}</strong>
        </span>
        <span>
          {t('audio.out')} <strong>{timecode(loop?.endMs ?? durationMs)}</strong>
        </span>
        <label>
          <button
            type="button"
            onClick={() => setMuted((current) => !current)}
            aria-label={t(muted ? 'audio.unmute' : 'audio.mute')}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            aria-label={t('audio.volume')}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
      </div>

      <audio
        ref={audioRef}
        src={asset.mediaUrl}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const reportedDuration = event.currentTarget.duration * 1000
          const mediaDuration = Number.isFinite(reportedDuration)
            ? Math.max(1, Math.round(reportedDuration))
            : Math.max(1, asset.durationMs ?? durationMs)
          setDurationMs(mediaDuration)
          event.currentTarget.volume = volume
          event.currentTarget.muted = muted
          if (autoPlay) play()
        }}
        onPlay={() => {
          claimAudioPreview(playerId)
          setPlaying(true)
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          const next = Math.round(event.currentTarget.currentTime * 1000)
          const looped = loopedAudioTime(next, loop, loopEnabled)
          if (looped !== null) {
            event.currentTarget.currentTime = looped / 1000
            setCurrentMs(looped)
          } else setCurrentMs(next)
        }}
        onEnded={() => {
          if (loopEnabled && loop) {
            seek(loop.startMs)
            play()
          } else setPlaying(false)
        }}
      />
    </section>
  )
}
