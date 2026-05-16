import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const requireFromMain = createRequire(__filename)
const ffprobeStatic = requireFromMain('ffprobe-static') as { path?: string }

export interface VideoMetadata {
  durationMs: number | null
  widthPixels: number | null
  heightPixels: number | null
  fps: number | null
  codec: string | null
  metadataJson: string | null
}

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  duration?: string
  avg_frame_rate?: string
  r_frame_rate?: string
}

interface FfprobeFormat {
  duration?: string
  format_name?: string
  bit_rate?: string
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

function parseNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === null) {
    return null
  }

  const parsed = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(parsed) ? parsed : null
}

function parseFps(value: string | undefined): number | null {
  if (!value || value === '0/0') {
    return null
  }

  const [rawNumerator, rawDenominator] = value.split('/')
  const numerator = Number(rawNumerator)
  const denominator = Number(rawDenominator)

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return parseNumber(value)
  }

  const fps = numerator / denominator

  return Number.isFinite(fps) && fps > 0 ? Number(fps.toFixed(3)) : null
}

function durationToMs(value: string | undefined): number | null {
  const seconds = parseNumber(value)

  return seconds === null || seconds < 0 ? null : Math.round(seconds * 1000)
}

function boundedMetadataJson(output: FfprobeOutput): string | null {
  const videoStreams = (output.streams ?? [])
    .filter((stream) => stream.codec_type === 'video')
    .slice(0, 2)
    .map((stream) => ({
      codec_name: stream.codec_name,
      width: stream.width,
      height: stream.height,
      avg_frame_rate: stream.avg_frame_rate,
      r_frame_rate: stream.r_frame_rate,
      duration: stream.duration
    }))
  const payload = {
    format: output.format
      ? {
          format_name: output.format.format_name,
          duration: output.format.duration,
          bit_rate: output.format.bit_rate
        }
      : null,
    videoStreams
  }
  const json = JSON.stringify(payload)

  return json.length > 8000 ? json.slice(0, 8000) : json
}

function metadataFromFfprobe(output: FfprobeOutput): VideoMetadata {
  const videoStream = (output.streams ?? []).find((stream) => stream.codec_type === 'video')
  const durationMs = durationToMs(videoStream?.duration) ?? durationToMs(output.format?.duration)

  return {
    durationMs,
    widthPixels: videoStream?.width ?? null,
    heightPixels: videoStream?.height ?? null,
    fps: parseFps(videoStream?.avg_frame_rate) ?? parseFps(videoStream?.r_frame_rate),
    codec: videoStream?.codec_name ?? null,
    metadataJson: boundedMetadataJson(output)
  }
}

export function getFfprobePath(): string | null {
  return typeof ffprobeStatic.path === 'string' && ffprobeStatic.path.length > 0
    ? ffprobeStatic.path
    : null
}

export async function probeVideo(filePath: string): Promise<VideoMetadata> {
  const ffprobePath = getFfprobePath()

  if (!ffprobePath) {
    throw new Error('Bundled ffprobe is unavailable.')
  }

  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath]

  return await new Promise<VideoMetadata>((resolve, reject) => {
    const child = spawn(ffprobePath, args, { windowsHide: true })
    const chunks: Buffer[] = []
    const errorChunks: Buffer[] = []
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('ffprobe timed out.'))
    }, 20_000)

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)

      if (code !== 0) {
        reject(new Error(Buffer.concat(errorChunks).toString('utf8') || 'ffprobe failed.'))
        return
      }

      try {
        resolve(metadataFromFfprobe(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
      } catch (error) {
        reject(error)
      }
    })
  })
}
