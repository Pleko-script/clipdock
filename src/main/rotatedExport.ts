import { createHash } from 'node:crypto'
import { open, stat, mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import type { ClipRotationDegrees, LibraryResult } from '../shared/clipdock'
import type { LibraryStore } from './libraryStore'

const ROTATION_TIMEOUT_MS = 10 * 60 * 1000
const VALIDATION_TIMEOUT_MS = 5 * 60 * 1000

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

function temporaryExportPath(outputPath: string): string {
  return join(dirname(outputPath), `${basename(outputPath)}.${process.pid}.${Date.now()}.tmp.mp4`)
}

async function fileHasContent(path: string): Promise<boolean> {
  try {
    const stats = await stat(path)

    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

async function fileLooksLikeMp4(filePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined

  try {
    handle = await open(filePath, 'r')
    const buffer = Buffer.alloc(12)
    const { bytesRead } = await handle.read(buffer, 0, 12, 0)

    if (bytesRead < 12) {
      return false
    }

    return buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  } catch {
    return false
  } finally {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // Handle close failure is non-fatal.
      }
    }
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

async function validatePlayableVideo(filePath: string): Promise<LibraryResult<void>> {
  const executablePath = ffmpegPath

  if (!executablePath) {
    return fail('FFmpeg is not available for rotated export validation.')
  }

  const args = ['-v', 'error', '-xerror', '-i', filePath, '-map', '0:v:0', '-f', 'null', '-']

  return await new Promise((resolve) => {
    const child = spawn(executablePath, args, { windowsHide: true })
    const errorChunks: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(fail('Rotated export validation timed out.'))
    }, VALIDATION_TIMEOUT_MS)

    child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk))
    child.on('error', () => {
      clearTimeout(timer)
      resolve(fail('Rotated export validation could not be started.'))
    })
    child.on('close', (code: number | null) => {
      clearTimeout(timer)

      if (code === 0) {
        resolve(ok(undefined))
        return
      }

      const details = Buffer.concat(errorChunks).toString('utf8').trim()

      resolve(
        fail(
          details
            ? `Rotated export validation failed: ${details}`
            : 'Rotated export validation failed.'
        )
      )
    })
  })
}

async function removeFileIfPresent(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true })
  } catch {
    // A failed cleanup should not hide the primary export error.
  }
}

async function renderValidatedRotation(
  sourcePath: string,
  outputPath: string,
  rotationDegrees: Exclude<ClipRotationDegrees, 0>
): Promise<LibraryResult<void>> {
  const tempPath = temporaryExportPath(outputPath)

  try {
    const rendered = await renderRotation(sourcePath, tempPath, rotationDegrees)

    if (!rendered.ok) {
      await removeFileIfPresent(tempPath)
      return rendered
    }

    const validated = await validatePlayableVideo(tempPath)

    if (!validated.ok) {
      await removeFileIfPresent(tempPath)
      return validated
    }

    await removeFileIfPresent(outputPath)
    await rename(tempPath, outputPath)
    return ok(undefined)
  } catch {
    await removeFileIfPresent(tempPath)
    return fail('Rotated export could not be finalized.')
  }
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

  if (cached.value && (await fileHasContent(cached.value.exportPath))) {
    if (await fileLooksLikeMp4(cached.value.exportPath)) {
      return ok(cached.value.exportPath)
    }

    await removeFileIfPresent(cached.value.exportPath)

    if (input.renderIfMissing === false) {
      return fail('Cached rotated export is invalid. Wait for ClipDock to prepare it again.')
    }
  }

  if (input.renderIfMissing === false) {
    return fail('Rotated export is not ready yet. Wait for ClipDock to finish preparing it.')
  }

  const outputPath = join(input.exportCacheDir, exportName(input))
  const rendered = await renderValidatedRotation(input.sourcePath, outputPath, rotationDegrees)

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
