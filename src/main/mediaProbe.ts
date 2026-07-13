import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { basename, extname } from 'node:path'

const requireFromMain = createRequire(__filename)
const ffprobeStatic = requireFromMain('ffprobe-static') as { path?: string }

export interface MediaMetadata {
  durationMs: number | null
  widthPixels: number | null
  heightPixels: number | null
  fps: number | null
  codec: string | null
  metadataJson: string | null
  audioCodec: string | null
  sampleRate: number | null
  channels: number | null
  ucsCatId: string | null
  ucsCategory: string | null
  ucsSubcategory: string | null
  hasAlpha: boolean
}

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  duration?: string
  avg_frame_rate?: string
  r_frame_rate?: string
  pix_fmt?: string
  sample_rate?: string
  channels?: number
  tags?: Record<string, string>
}

interface FfprobeFormat {
  duration?: string
  format_name?: string
  bit_rate?: string
  tags?: Record<string, string>
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

function ucsValue(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ').slice(0, 128)
  return normalized || null
}

function ucsMetadata(
  output: FfprobeOutput,
  filePath?: string
): Pick<MediaMetadata, 'ucsCatId' | 'ucsCategory' | 'ucsSubcategory'> {
  const tags = new Map<string, string>()
  for (const source of [
    output.format?.tags,
    ...(output.streams ?? []).map((stream) => stream.tags)
  ]) {
    for (const [key, value] of Object.entries(source ?? {})) {
      const normalizedKey = key.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '')
      if (!tags.has(normalizedKey)) tags.set(normalizedKey, value)
    }
  }
  const value = (...keys: string[]): string | null =>
    ucsValue(keys.map((key) => tags.get(key)).find(Boolean))
  let ucsCategory = value('ucscategory', 'category')
  let ucsSubcategory = value('ucssubcategory', 'subcategory')
  const categoryFull = value('ucscategoryfull', 'categoryfull')
  if (categoryFull && (!ucsCategory || !ucsSubcategory)) {
    const [category, ...subcategory] = categoryFull.split(/\s*[-/]\s*/)
    ucsCategory ??= ucsValue(category)
    ucsSubcategory ??= ucsValue(subcategory.join('-'))
  }
  let ucsCatId = value('ucscatid', 'catid')
  if (!ucsCatId && filePath) {
    const blocks = basename(filePath, extname(filePath)).split('_')
    const candidate = blocks.length >= 4 ? blocks[0].split('-')[0] : ''
    if (/^[A-Z]{2,8}[A-Za-z0-9]{1,18}$/.test(candidate)) ucsCatId = candidate
  }
  return { ucsCatId, ucsCategory, ucsSubcategory }
}

export function metadataFromFfprobe(output: FfprobeOutput, filePath?: string): MediaMetadata {
  const videoStream = (output.streams ?? []).find((stream) => stream.codec_type === 'video')
  const audioStream = (output.streams ?? []).find((stream) => stream.codec_type === 'audio')
  const durationMs = durationToMs(videoStream?.duration) ?? durationToMs(output.format?.duration)
  const pixelFormat = videoStream?.pix_fmt?.toLowerCase() ?? ''
  const ucs = ucsMetadata(output, filePath)

  return {
    durationMs,
    widthPixels: videoStream?.width ?? null,
    heightPixels: videoStream?.height ?? null,
    fps: parseFps(videoStream?.avg_frame_rate) ?? parseFps(videoStream?.r_frame_rate),
    codec: videoStream?.codec_name ?? null,
    metadataJson: boundedMetadataJson(output),
    audioCodec: audioStream?.codec_name ?? null,
    sampleRate: parseNumber(audioStream?.sample_rate),
    channels: audioStream?.channels ?? null,
    ...ucs,
    hasAlpha:
      pixelFormat.includes('rgba') ||
      pixelFormat.includes('argb') ||
      pixelFormat.includes('yuva') ||
      pixelFormat.includes('gbrap')
  }
}

export function getFfprobePath(): string | null {
  return typeof ffprobeStatic.path === 'string' && ffprobeStatic.path.length > 0
    ? ffprobeStatic.path
    : null
}

export async function probeMedia(filePath: string): Promise<MediaMetadata> {
  const ffprobePath = getFfprobePath()

  if (!ffprobePath) {
    throw new Error('Bundled ffprobe is unavailable.')
  }

  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath]

  return await new Promise<MediaMetadata>((resolve, reject) => {
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
        resolve(metadataFromFfprobe(JSON.parse(Buffer.concat(chunks).toString('utf8')), filePath))
      } catch (error) {
        reject(error)
      }
    })
  })
}
