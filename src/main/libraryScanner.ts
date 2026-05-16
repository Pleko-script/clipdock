import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  SUPPORTED_VIDEO_EXTENSIONS,
  type ClipdockError,
  type ClipImportMode,
  type ScanEvent,
  type ScanResult,
  type ScanSummary
} from '../shared/clipdock'
import { probeVideo } from './mediaProbe'
import { generateThumbnail } from './thumbnailer'
import type { LibraryStore, ScannableSource } from './libraryStore'

const HIDDEN_OR_SYSTEM_NAMES = new Set([
  '$RECYCLE.BIN',
  'System Volume Information',
  'node_modules',
  '.git',
  '.svn',
  '.hg'
])

export interface ScanOptions {
  store: LibraryStore
  thumbnailCacheDir: string
  emit?: (event: ScanEvent) => void
  now?: () => number
}

interface CandidateFile {
  source: ScannableSource
  filePath: string
  importMode: ClipImportMode
  targetPath: string | null
}

interface ScanCounters {
  importedClips: number
  updatedClips: number
  skippedClips: number
  failedClips: number
}

function isSupportedVideoPath(filePath: string): boolean {
  const lower = filePath.toLocaleLowerCase('en-US')

  return SUPPORTED_VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

function shouldSkipDirectory(name: string): boolean {
  return name.startsWith('.') || HIDDEN_OR_SYSTEM_NAMES.has(name)
}

async function collectFolderVideos(
  source: ScannableSource,
  folderPath: string
): Promise<CandidateFile[]> {
  const candidates: CandidateFile[] = []
  const dirents = await readdir(folderPath, { withFileTypes: true })

  for (const dirent of dirents) {
    if (dirent.isDirectory()) {
      if (!shouldSkipDirectory(dirent.name)) {
        candidates.push(...(await collectFolderVideos(source, join(folderPath, dirent.name))))
      }

      continue
    }

    if (dirent.isFile()) {
      const filePath = join(folderPath, dirent.name)

      if (isSupportedVideoPath(filePath)) {
        candidates.push({
          source,
          filePath,
          importMode: 'linked-folder',
          targetPath: null
        })
      }
    }
  }

  return candidates
}

async function collectCandidates(sources: ScannableSource[]): Promise<CandidateFile[]> {
  const candidates: CandidateFile[] = []

  for (const source of sources) {
    if (source.kind === 'folder') {
      candidates.push(...(await collectFolderVideos(source, source.sourcePath)))
      continue
    }

    const filePath = source.targetPath ?? source.sourcePath

    if (isSupportedVideoPath(filePath)) {
      candidates.push({
        source,
        filePath,
        importMode: 'copied-file',
        targetPath: source.targetPath
      })
    }
  }

  return candidates
}

function createError(
  code: ClipdockError['code'],
  message: string,
  sourcePath?: string
): ClipdockError {
  return {
    code,
    phase: code === 'THUMBNAIL_FAILED' ? 'thumbnail' : code === 'PROBE_FAILED' ? 'probe' : 'scan',
    message,
    ...(sourcePath ? { sourcePath } : {})
  }
}

async function scanOneCandidate(
  options: ScanOptions,
  candidate: CandidateFile,
  counters: ScanCounters
): Promise<void> {
  const stats = await stat(candidate.filePath)
  const sizeBytes = stats.size
  const modifiedAtMs = Math.round(stats.mtimeMs)
  const fileCreatedAtMs = Math.round(stats.birthtimeMs)
  const freshness = options.store.isClipUpToDate({
    filePath: candidate.filePath,
    sizeBytes,
    modifiedAtMs
  })

  if (freshness.ok && freshness.value) {
    counters.skippedClips += 1
    return
  }

  let metadata = {
    durationMs: null as number | null,
    widthPixels: null as number | null,
    heightPixels: null as number | null,
    fps: null as number | null,
    codec: null as string | null,
    metadataJson: null as string | null
  }
  let status: 'ready' | 'error' = 'ready'
  let lastError: ClipdockError | null = null

  try {
    metadata = await probeVideo(candidate.filePath)
  } catch {
    status = 'error'
    lastError = createError(
      'PROBE_FAILED',
      'FFprobe could not read metadata for this video.',
      candidate.filePath
    )
  }

  const thumbnail = await generateThumbnail(
    candidate.filePath,
    options.thumbnailCacheDir,
    modifiedAtMs,
    metadata.durationMs,
    basename(candidate.filePath)
  )

  if (thumbnail.placeholder && !lastError) {
    lastError = createError(
      'THUMBNAIL_FAILED',
      'FFmpeg could not generate a thumbnail; a placeholder was stored.',
      candidate.filePath
    )
  }

  const upsert = options.store.upsertScannedClip({
    sourceId: candidate.source.id,
    importMode: candidate.importMode,
    sourcePath:
      candidate.importMode === 'copied-file' ? candidate.source.sourcePath : candidate.filePath,
    targetPath: candidate.targetPath,
    sizeBytes,
    modifiedAtMs,
    fileCreatedAtMs,
    durationMs: metadata.durationMs,
    widthPixels: metadata.widthPixels,
    heightPixels: metadata.heightPixels,
    fps: metadata.fps,
    codec: metadata.codec,
    metadataJson: metadata.metadataJson,
    thumbnailPath: thumbnail.path,
    thumbnailGeneratedAtMs: Math.round(options.now?.() ?? Date.now()),
    status,
    lastErrorCode: lastError?.code ?? null,
    lastErrorMessage: lastError?.message ?? null
  })

  if (!upsert.ok) {
    throw upsert.error
  }

  if (upsert.value.created) {
    counters.importedClips += 1
  } else {
    counters.updatedClips += 1
  }

  if (lastError) {
    counters.failedClips += 1
  }
}

export async function scanLibrary(options: ScanOptions): Promise<ScanResult> {
  const now = options.now ?? Date.now
  const startedAtMs = Math.round(now())
  const sourcesResult = options.store.listScannableSources()

  if (!sourcesResult.ok) {
    throw sourcesResult.error
  }

  if (sourcesResult.value.length === 0) {
    const snapshot = options.store.snapshot()

    if (!snapshot.ok) {
      throw snapshot.error
    }

    const summary: ScanSummary = {
      sourceCount: 0,
      totalFiles: 0,
      scannedFiles: 0,
      importedClips: 0,
      updatedClips: 0,
      skippedClips: 0,
      failedClips: 0,
      startedAtMs,
      completedAtMs: Math.round(now())
    }

    return { snapshot: snapshot.value, summary }
  }

  const candidates = await collectCandidates(sourcesResult.value)
  const counters: ScanCounters = {
    importedClips: 0,
    updatedClips: 0,
    skippedClips: 0,
    failedClips: 0
  }
  let scannedFiles = 0

  options.emit?.({
    type: 'scan-started',
    sourceCount: sourcesResult.value.length,
    totalFiles: candidates.length,
    startedAtMs
  })

  for (const source of sourcesResult.value) {
    const started = options.store.markSourceScanStarted(source.id)

    if (!started.ok) {
      options.emit?.({ type: 'scan-failed', error: started.error })
    }
  }

  for (const candidate of candidates) {
    scannedFiles += 1
    options.emit?.({
      type: 'scan-progress',
      sourceId: candidate.source.id,
      currentFile: candidate.filePath,
      scannedFiles,
      totalFiles: candidates.length
    })

    try {
      await scanOneCandidate(options, candidate, counters)
    } catch (error) {
      counters.failedClips += 1
      const clipError =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as ClipdockError)
          : createError('SCAN_FAILED', 'ClipDock could not scan this file.', candidate.filePath)

      options.emit?.({
        type: 'scan-file-error',
        sourceId: candidate.source.id,
        currentFile: candidate.filePath,
        error: clipError,
        scannedFiles,
        totalFiles: candidates.length
      })
    }
  }

  for (const source of sourcesResult.value) {
    const completed = options.store.markSourceScanCompleted(source.id)

    if (!completed.ok) {
      options.emit?.({ type: 'scan-failed', error: completed.error })
    }
  }

  const snapshot = options.store.snapshot()

  if (!snapshot.ok) {
    throw snapshot.error
  }

  const summary: ScanSummary = {
    sourceCount: sourcesResult.value.length,
    totalFiles: candidates.length,
    scannedFiles,
    importedClips: counters.importedClips,
    updatedClips: counters.updatedClips,
    skippedClips: counters.skippedClips,
    failedClips: counters.failedClips,
    startedAtMs,
    completedAtMs: Math.round(now())
  }

  options.emit?.({ type: 'scan-completed', summary })

  return { snapshot: snapshot.value, summary }
}
