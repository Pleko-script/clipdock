import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssetTrimSource } from './assetTrimStore'
import type { VideoRotation } from '../shared/clipdock'
import { runFfmpeg } from './mediaProcess'

const TRIM_PIPELINE_VERSION = 2

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(3)
}

function safeName(value: string): string {
  return (
    [...value]
      .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/[. ]+$/g, '')
      .trim()
      .slice(0, 80) || 'clip'
  )
}

function trimCacheKey(
  asset: AssetTrimSource,
  startMs: number,
  endMs: number,
  rotationDegrees: VideoRotation
): string {
  const normalizedPath =
    process.platform === 'win32' ? asset.filePath.toLocaleLowerCase('en-US') : asset.filePath
  return createHash('sha256')
    .update(normalizedPath)
    .update('\0')
    .update(String(asset.sizeBytes))
    .update('\0')
    .update(String(asset.modifiedAtMs))
    .update('\0')
    .update(String(startMs))
    .update('\0')
    .update(String(endMs))
    .update('\0')
    .update(String(rotationDegrees))
    .update('\0')
    .update(String(TRIM_PIPELINE_VERSION))
    .digest('hex')
    .slice(0, 20)
}

export async function generateTrimmedAsset(
  asset: AssetTrimSource,
  startMs: number,
  endMs: number,
  rotationDegrees: VideoRotation,
  cacheDir: string
): Promise<string> {
  await mkdir(cacheDir, { recursive: true })
  const extension = asset.hasAlpha ? '.mov' : '.mp4'
  const cacheKey = trimCacheKey(asset, startMs, endMs, rotationDegrees)
  const outputPath = join(
    cacheDir,
    `${safeName(asset.displayName)}-range-${seconds(startMs)}-${seconds(endMs)}-r${rotationDegrees}-${cacheKey}${extension}`
  )
  try {
    if ((await stat(outputPath)).isFile()) return outputPath
  } catch {
    // The cache entry does not exist yet.
  }

  const temporaryPath = join(cacheDir, `${cacheKey}-${randomUUID()}.tmp${extension}`)
  const rotationFilter =
    rotationDegrees === 90
      ? 'transpose=clock'
      : rotationDegrees === 180
        ? 'hflip,vflip'
        : rotationDegrees === 270
          ? 'transpose=cclock'
          : null
  const videoArguments = asset.hasAlpha
    ? ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-c:a', 'pcm_s16le']
    : [
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart'
      ]
  try {
    await runFfmpeg(
      [
        '-y',
        '-ss',
        seconds(startMs),
        '-i',
        asset.filePath,
        '-t',
        seconds(endMs - startMs),
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-map_metadata',
        '0',
        ...(rotationFilter ? ['-vf', rotationFilter] : []),
        '-metadata:s:v:0',
        'rotate=0',
        '-sn',
        '-dn',
        ...videoArguments,
        temporaryPath
      ],
      10 * 60_000
    )
    await access(temporaryPath)
    await rename(temporaryPath, outputPath)
    return outputPath
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}
