import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssetSummary } from '../shared/clipdock'
import { writePlaceholderThumbnail } from './thumbnailer'

const requireFromMain = createRequire(__filename)
const ffmpegPath = requireFromMain('ffmpeg-static') as string | null
const PREVIEW_PIPELINE_VERSION = 2

export interface AssetPreviewResult {
  thumbnailPath: string
  previewPath: string | null
}

async function runFfmpeg(args: string[], timeoutMs = 60_000): Promise<void> {
  if (!ffmpegPath) throw new Error('Bundled FFmpeg is unavailable.')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    const errors: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('FFmpeg preview generation timed out.'))
    }, timeoutMs)
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else
        reject(
          new Error(
            Buffer.concat(errors).toString('utf8').trim() || 'FFmpeg preview generation failed.'
          )
        )
    })
  })
}

function encodeArgs(outputPath: string): string[] {
  return [
    '-map',
    '[out]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '25',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-t',
    '4',
    outputPath
  ]
}

async function renderVideoPreview(asset: AssetSummary, outputPath: string): Promise<void> {
  const scale = `scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2`
  if (asset.kind === 'transition') {
    await runFfmpeg([
      '-y',
      '-i',
      asset.filePath,
      '-f',
      'lavfi',
      '-i',
      'color=c=0x1d3a4f:s=640x360:r=30:d=0.75',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x70452f:s=640x360:r=30:d=0.75',
      '-filter_complex',
      `[1:v]drawgrid=w=80:h=80:t=2:c=0x55c2ff@0.35,format=yuv420p[a];[0:v]trim=duration=2.5,setpts=PTS-STARTPTS,${scale},fps=30,format=yuv420p[fx];[2:v]drawgrid=w=80:h=80:t=2:c=0xf6c85f@0.35,format=yuv420p[b];[a][fx][b]concat=n=3:v=1:a=0[out]`,
      ...encodeArgs(outputPath)
    ])
    return
  }

  if (
    asset.kind === 'overlay' &&
    (asset.overlayMode === 'alpha' || asset.overlayMode === 'screen')
  ) {
    const combine =
      asset.overlayMode === 'screen'
        ? `[1:v]format=yuv420p[bg];[0:v]trim=duration=4,setpts=PTS-STARTPTS,${scale},fps=30,format=yuv420p[fg];[bg][fg]blend=all_mode=screen[out]`
        : `[1:v]format=yuv420p[bg];[0:v]trim=duration=4,setpts=PTS-STARTPTS,${scale},fps=30[fg];[bg][fg]overlay=shortest=1,format=yuv420p[out]`
    await runFfmpeg([
      '-y',
      '-i',
      asset.filePath,
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30:duration=4',
      '-filter_complex',
      combine,
      ...encodeArgs(outputPath)
    ])
    return
  }

  await runFfmpeg([
    '-y',
    '-i',
    asset.filePath,
    '-filter_complex',
    `[0:v]trim=duration=4,setpts=PTS-STARTPTS,${scale},fps=30,format=yuv420p[out]`,
    ...encodeArgs(outputPath)
  ])
}

async function renderWaveform(asset: AssetSummary, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    asset.filePath,
    '-filter_complex',
    'aformat=channel_layouts=mono,showwavespic=s=640x360:colors=0x55c2ff,format=rgba,colorchannelmixer=aa=0.9',
    '-frames:v',
    '1',
    outputPath
  ])
}

function previewCacheKey(asset: AssetSummary): string {
  const normalizedPath =
    process.platform === 'win32' ? asset.filePath.toLocaleLowerCase('en-US') : asset.filePath
  return createHash('sha256')
    .update(normalizedPath)
    .update('\0')
    .update(String(asset.sizeBytes))
    .update('\0')
    .update(String(asset.modifiedAtMs))
    .update('\0')
    .update(asset.kind)
    .update('\0')
    .update(asset.overlayMode)
    .update('\0')
    .update(String(PREVIEW_PIPELINE_VERSION))
    .digest('hex')
    .slice(0, 24)
}

async function renderWebpThumbnail(previewPath: string, thumbnailPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-ss',
    '0.5',
    '-i',
    previewPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=640:-2',
    '-c:v',
    'libwebp',
    '-quality',
    '80',
    thumbnailPath
  ])
}

export async function generateAssetPreview(
  asset: AssetSummary,
  previewCacheDir: string
): Promise<AssetPreviewResult> {
  await mkdir(previewCacheDir, { recursive: true })
  const cacheKey = previewCacheKey(asset)
  if (asset.mediaType === 'audio') {
    const waveformPath = join(previewCacheDir, `${asset.id}-${cacheKey}-waveform.webp`)
    try {
      await renderWaveform(asset, waveformPath)
      await access(waveformPath)
      return { thumbnailPath: waveformPath, previewPath: null }
    } catch {
      const fallback = await writePlaceholderThumbnail(
        join(previewCacheDir, `${asset.id}-${cacheKey}-waveform.jpg`),
        asset.displayName
      )
      return { thumbnailPath: fallback, previewPath: null }
    }
  }

  const previewPath = join(previewCacheDir, `${asset.id}-${cacheKey}-preview.mp4`)
  const thumbnailPath = join(previewCacheDir, `${asset.id}-${cacheKey}-thumbnail.webp`)
  await renderVideoPreview(asset, previewPath)
  await access(previewPath)
  await renderWebpThumbnail(previewPath, thumbnailPath)
  await access(thumbnailPath)
  return { thumbnailPath, previewPath }
}
