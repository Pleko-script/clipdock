import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AssetSummary } from '../shared/clipdock'
import { runFfmpeg } from './mediaProcess'

export const PREVIEW_PIPELINE_VERSION = 4

export interface AssetPreviewResult {
  thumbnailPath: string
  previewPath: string | null
}

async function writePlaceholderThumbnail(filePath: string, label: string): Promise<string> {
  const path = filePath.replace(/\.jpg$/i, '.svg')
  const safeLabel = label.replace(/[<>&"]/g, '-').slice(0, 72)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#15191f"/><path d="M40 180h560" stroke="#2a313b" stroke-width="2"/><text x="320" y="195" text-anchor="middle" fill="#8f9aa8" font-family="sans-serif" font-size="22">${safeLabel}</text></svg>`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, svg, 'utf8')
  return path
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
  const fitOpaque =
    'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2'
  const fitAlpha =
    'scale=640:360:force_original_aspect_ratio=decrease,format=rgba,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black@0'
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
      `[1:v]drawgrid=w=80:h=80:t=2:c=0x55c2ff@0.35,format=yuv420p[a];[0:v]trim=duration=2.5,setpts=PTS-STARTPTS,${fitOpaque},fps=30,format=yuv420p[fx];[2:v]drawgrid=w=80:h=80:t=2:c=0xf6c85f@0.35,format=yuv420p[b];[a][fx][b]concat=n=3:v=1:a=0[out]`,
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
        ? `[1:v]format=yuv420p[bg];[0:v]trim=duration=4,setpts=PTS-STARTPTS,${fitOpaque},fps=30,format=yuv420p[fg];[bg][fg]blend=all_mode=screen[out]`
        : `[1:v]format=yuv420p[bg];[0:v]trim=duration=4,setpts=PTS-STARTPTS,${fitAlpha},fps=30[fg];[bg][fg]overlay=shortest=1,format=yuv420p[out]`
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
    `[0:v]trim=duration=4,setpts=PTS-STARTPTS,${fitOpaque},fps=30,format=yuv420p[out]`,
    ...encodeArgs(outputPath)
  ])
}

async function renderWaveform(asset: AssetSummary, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    asset.filePath,
    '-filter_complex',
    'aformat=channel_layouts=mono,showwavespic=s=640x360:colors=0xECECEA,format=rgba,colorchannelmixer=aa=0.9',
    '-frames:v',
    '1',
    outputPath
  ])
}

async function renderSpectrogram(asset: AssetSummary, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    asset.filePath,
    '-filter_complex',
    'aformat=channel_layouts=mono,showspectrumpic=s=640x360:legend=disabled:color=fiery:scale=log',
    '-frames:v',
    '1',
    outputPath
  ])
}

export function previewCacheKey(asset: AssetSummary): string {
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
    .update(asset.mediaType)
    .update('\0')
    .update(asset.overlayMode)
    .update('\0')
    .update(String(PREVIEW_PIPELINE_VERSION))
    .digest('hex')
    .slice(0, 24)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
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

export async function generatePosterFrame(
  asset: AssetSummary,
  previewCacheDir: string,
  frameMs: number
): Promise<string> {
  if (asset.mediaType !== 'video') throw new Error('Poster frames require a video asset.')
  const maximum = Math.max(0, (asset.durationMs ?? frameMs) - 1)
  const safeFrameMs = Math.min(maximum, Math.max(0, Math.round(frameMs)))
  const outputPath = join(
    previewCacheDir,
    `${asset.id}-${previewCacheKey(asset)}-poster-${safeFrameMs}.webp`
  )
  await mkdir(previewCacheDir, { recursive: true })
  await runFfmpeg([
    '-y',
    '-i',
    asset.filePath,
    '-ss',
    (safeFrameMs / 1000).toFixed(3),
    '-frames:v',
    '1',
    '-vf',
    'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2',
    '-c:v',
    'libwebp',
    '-quality',
    '85',
    outputPath
  ])
  await access(outputPath)
  return outputPath
}

export async function generateAssetPreview(
  asset: AssetSummary,
  previewCacheDir: string
): Promise<AssetPreviewResult> {
  await mkdir(previewCacheDir, { recursive: true })
  const cacheKey = previewCacheKey(asset)
  if (asset.mediaType === 'audio') {
    const waveformPath = join(previewCacheDir, `${asset.id}-${cacheKey}-waveform.webp`)
    const spectrogramPath = join(previewCacheDir, `${asset.id}-${cacheKey}-spectrogram.webp`)
    let thumbnailPath = waveformPath
    try {
      if (!(await pathExists(waveformPath))) await renderWaveform(asset, waveformPath)
      await access(waveformPath)
    } catch {
      thumbnailPath = await writePlaceholderThumbnail(
        join(previewCacheDir, `${asset.id}-${cacheKey}-waveform.jpg`),
        asset.displayName
      )
    }
    let previewPath: string | null = spectrogramPath
    try {
      if (!(await pathExists(spectrogramPath))) await renderSpectrogram(asset, spectrogramPath)
      await access(spectrogramPath)
    } catch {
      previewPath = null
    }
    return { thumbnailPath, previewPath }
  }

  const previewPath = join(previewCacheDir, `${asset.id}-${cacheKey}-preview.mp4`)
  const thumbnailPath = join(previewCacheDir, `${asset.id}-${cacheKey}-thumbnail.webp`)
  await renderVideoPreview(asset, previewPath)
  await access(previewPath)
  await renderWebpThumbnail(previewPath, thumbnailPath)
  await access(thumbnailPath)
  return { thumbnailPath, previewPath }
}
