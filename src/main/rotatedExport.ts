import { createHash } from 'node:crypto'
import { stat, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import type { ClipRotationDegrees, LibraryResult } from '../shared/clipdock'
import type { LibraryStore } from './libraryStore'

const ROTATION_TIMEOUT_MS = 10 * 60 * 1000

export interface ResolveRotatedExportInput {
  store: LibraryStore
  clipId: string
  sourcePath: string
  sourceSizeBytes: number
  sourceModifiedAtMs: number
  rotationDegrees: ClipRotationDegrees
  exportCacheDir: string
  renderIfMissing?: boolean
}

function ok<T>(value: T): LibraryResult<T> {
  return { ok: true, value }
}

function fail<T>(message: string): LibraryResult<T> {
  return { ok: false, error: { code: 'CLIP_EXPORT_FAILED', phase: 'export', message } }
}

function filterForRotation(rotationDegrees: Exclude<ClipRotationDegrees, 0>): string {
  if (rotationDegrees === 90) return 'transpose=1'
  if (rotationDegrees === 180) return 'transpose=1,transpose=1'

  return 'transpose=2'
}

function exportName(input: ResolveRotatedExportInput): string {
  const hash = createHash('sha256')
    .update(input.clipId)
    .update(String(input.rotationDegrees))
    .update(String(input.sourceSizeBytes))
    .update(String(input.sourceModifiedAtMs))
    .digest('hex')
    .slice(0, 24)

  return `${hash}-rot${input.rotationDegrees}.mp4`
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)

    return stats.isFile()
  } catch {
    return false
  }
}

async function renderRotation(
  sourcePath: string,
  outputPath: string,
  rotationDegrees: Exclude<ClipRotationDegrees, 0>
): Promise<LibraryResult<void>> {
  const executablePath = ffmpegPath

  if (!executablePath) {
    return fail('FFmpeg is not available for rotated exports.')
  }

  await mkdir(dirname(outputPath), { recursive: true })

  const args = [
    '-y',
    '-i',
    sourcePath,
    '-vf',
    filterForRotation(rotationDegrees),
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    outputPath
  ]

  return await new Promise((resolve) => {
    const child = spawn(executablePath, args, { windowsHide: true })
    const errorChunks: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(fail('Rotated export timed out.'))
    }, ROTATION_TIMEOUT_MS)

    child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(fail('Rotated export could not be started.'))
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)

      if (code === 0) {
        resolve(ok(undefined))
        return
      }

      resolve(fail(Buffer.concat(errorChunks).toString('utf8') || 'Rotated export failed.'))
    })
  })
}

export async function resolveRotatedExportPath(
  input: ResolveRotatedExportInput
): Promise<LibraryResult<string>> {
  if (input.rotationDegrees === 0) {
    return ok(input.sourcePath)
  }

  const rotationDegrees = input.rotationDegrees
  const cached = input.store.getClipRotationExport({
    clipId: input.clipId,
    rotationDegrees,
    sourceSizeBytes: input.sourceSizeBytes,
    sourceModifiedAtMs: input.sourceModifiedAtMs
  })

  if (!cached.ok) {
    return cached
  }

  if (cached.value && (await fileExists(cached.value.exportPath))) {
    return ok(cached.value.exportPath)
  }

  if (input.renderIfMissing === false) {
    return fail('Rotated export is not ready yet. Wait for ClipDock to finish preparing it.')
  }

  const outputPath = join(input.exportCacheDir, exportName(input))
  const rendered = await renderRotation(input.sourcePath, outputPath, rotationDegrees)

  if (!rendered.ok) {
    return rendered
  }

  const saved = input.store.upsertClipRotationExport({
    clipId: input.clipId,
    rotationDegrees,
    sourceSizeBytes: input.sourceSizeBytes,
    sourceModifiedAtMs: input.sourceModifiedAtMs,
    exportPath: outputPath
  })

  return saved.ok ? ok(saved.value.exportPath) : saved
}
