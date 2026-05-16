import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const requireFromMain = createRequire(__filename)
const ffmpegPath = requireFromMain('ffmpeg-static') as string | null

export interface ThumbnailResult {
  path: string
  placeholder: boolean
}

export function createThumbnailPath(
  cacheDir: string,
  filePath: string,
  modifiedAtMs: number
): string {
  const hash = createHash('sha256')
    .update(filePath)
    .update('\0')
    .update(String(modifiedAtMs))
    .digest('hex')
    .slice(0, 36)

  return join(cacheDir, `${hash}.jpg`)
}

function createPlaceholderSvg(label: string): string {
  const safeLabel = label.replace(/[<>&"]/g, '-').slice(0, 72)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#151a22"/>
  <rect x="20" y="20" width="600" height="320" rx="18" fill="#202734" stroke="#3c4859"/>
  <path d="M280 128v104l96-52z" fill="#9fb3c8"/>
  <text x="320" y="286" text-anchor="middle" fill="#d8e1ec" font-family="Segoe UI, Arial" font-size="24" font-weight="700">${safeLabel}</text>
</svg>`
}

export async function writePlaceholderThumbnail(
  stablePath: string,
  label: string
): Promise<string> {
  const placeholderPath = stablePath.replace(/\.jpg$/i, '.svg')

  await mkdir(dirname(placeholderPath), { recursive: true })
  await writeFile(placeholderPath, createPlaceholderSvg(label), 'utf8')

  return placeholderPath
}

export async function generateThumbnail(
  filePath: string,
  cacheDir: string,
  modifiedAtMs: number,
  durationMs: number | null,
  label: string
): Promise<ThumbnailResult> {
  const thumbnailPath = createThumbnailPath(cacheDir, filePath, modifiedAtMs)

  if (!ffmpegPath) {
    return {
      path: await writePlaceholderThumbnail(thumbnailPath, label),
      placeholder: true
    }
  }

  await mkdir(dirname(thumbnailPath), { recursive: true })

  const durationSeconds = durationMs && durationMs > 0 ? durationMs / 1000 : null
  const seekSeconds = durationSeconds
    ? Math.max(0.1, Math.min(durationSeconds * 0.1, Math.max(0.1, durationSeconds - 0.25)))
    : 1
  const args = [
    '-y',
    '-ss',
    String(Number(seekSeconds.toFixed(3))),
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=640:-1',
    '-q:v',
    '4',
    thumbnailPath
  ]

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath, args, { windowsHide: true })
      const errorChunks: Buffer[] = []
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('ffmpeg thumbnail generation timed out.'))
      }, 30_000)

      child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk))
      child.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timeout)

        if (code === 0) {
          resolve()
          return
        }

        reject(new Error(Buffer.concat(errorChunks).toString('utf8') || 'ffmpeg failed.'))
      })
    })

    await access(thumbnailPath)

    return { path: thumbnailPath, placeholder: false }
  } catch {
    return {
      path: await writePlaceholderThumbnail(thumbnailPath, label),
      placeholder: true
    }
  }
}
