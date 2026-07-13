import { readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import {
  type AssetJobEvent,
  type AssetPackSummary,
  type AssetScanResult,
  type OverlayMode
} from '../shared/clipdock'
import { assetMediaType, inferAssetKind } from './assetClassification'
import type { AssetStore } from './assetStore'
import { probeMedia } from './mediaProbe'

const SKIPPED_DIRECTORIES = new Set([
  '$RECYCLE.BIN',
  'System Volume Information',
  'node_modules',
  '.git',
  '.svn',
  '.hg'
])

async function collectMediaFiles(folderPath: string): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(folderPath, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(folderPath, entry.name)
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name))
        files.push(...(await collectMediaFiles(path)))
    } else if (entry.isFile() && assetMediaType(path)) {
      files.push(path)
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

interface ScannedFileResult {
  id: string
  created: boolean
  probeFailed: boolean
}

async function scanMediaFile(
  store: AssetStore,
  pack: AssetPackSummary,
  filePath: string,
  index: number,
  total: number,
  emit?: (event: AssetJobEvent) => void
): Promise<ScannedFileResult> {
  emit?.({
    type: 'scan-progress',
    packId: pack.id,
    currentFile: filePath,
    completed: index,
    total
  })
  const stats = await stat(filePath)
  const mediaType = assetMediaType(filePath)
  if (!mediaType) throw new Error('Unsupported media file.')
  let probeFailed = false
  let metadata = {
    durationMs: null as number | null,
    widthPixels: null as number | null,
    heightPixels: null as number | null,
    fps: null as number | null,
    codec: null as string | null,
    audioCodec: null as string | null,
    sampleRate: null as number | null,
    channels: null as number | null,
    hasAlpha: false,
    metadataJson: null as string | null
  }
  try {
    metadata = await probeMedia(filePath)
  } catch {
    probeFailed = true
  }
  const kind = inferAssetKind(relative(pack.rootPath, filePath), mediaType)
  const overlayMode: OverlayMode = kind === 'overlay' && metadata.hasAlpha ? 'alpha' : 'raw'
  const saved = store.upsertScannedAsset({
    packId: pack.id,
    filePath,
    kind,
    mediaType,
    overlayMode,
    compatibility: 'expected',
    sizeBytes: stats.size,
    modifiedAtMs: Math.round(stats.mtimeMs),
    durationMs: metadata.durationMs,
    widthPixels: metadata.widthPixels,
    heightPixels: metadata.heightPixels,
    fps: metadata.fps,
    codec: metadata.codec,
    audioCodec: metadata.audioCodec,
    sampleRate: metadata.sampleRate,
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha,
    metadataJson: metadata.metadataJson
  })
  if (!saved.ok) throw new Error(saved.error.message)
  return { ...saved.value, probeFailed }
}

function scanResult(
  packId: string,
  scannedFiles: number,
  importedAssets: number,
  updatedAssets: number,
  missingAssets: number,
  failedAssets: number
): AssetScanResult {
  return {
    packId,
    scannedFiles,
    importedAssets,
    updatedAssets,
    missingAssets,
    failedAssets
  }
}

export async function scanAssetPack(
  store: AssetStore,
  pack: AssetPackSummary,
  emit?: (event: AssetJobEvent) => void
): Promise<AssetScanResult> {
  const files = await collectMediaFiles(pack.rootPath)
  const seenIds: string[] = []
  let importedAssets = 0
  let updatedAssets = 0
  let failedAssets = 0

  for (let index = 0; index < files.length; index += 1) {
    try {
      const saved = await scanMediaFile(store, pack, files[index], index, files.length, emit)
      seenIds.push(saved.id)
      if (saved.created) importedAssets += 1
      else updatedAssets += 1
      if (saved.probeFailed) failedAssets += 1
    } catch {
      failedAssets += 1
    }
  }

  const finished = store.finishPackScan(pack.id, seenIds)
  if (!finished.ok) throw new Error(finished.error.message)
  const result = scanResult(
    pack.id,
    files.length,
    importedAssets,
    updatedAssets,
    finished.value,
    failedAssets
  )
  emit?.({ type: 'scan-completed', result })
  return result
}

export async function reconcileAssetPackPaths(
  store: AssetStore,
  pack: AssetPackSummary,
  changedPaths: string[] | null,
  emit?: (event: AssetJobEvent) => void
): Promise<AssetScanResult | null> {
  try {
    if (!(await stat(pack.rootPath)).isDirectory()) return null
  } catch {
    return null
  }
  if (changedPaths === null) return scanAssetPack(store, pack, emit)

  const root = resolve(pack.rootPath)
  const scopes: string[] = []
  const missingScopes: string[] = []
  const files = new Set<string>()
  for (const changedPath of [...new Set(changedPaths)]) {
    const absolute = resolve(root, changedPath)
    if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) continue
    const relativeScope = relative(root, absolute)
    if (!relativeScope) return scanAssetPack(store, pack, emit)
    scopes.push(relativeScope)
    try {
      const stats = await stat(absolute)
      if (stats.isDirectory()) {
        for (const filePath of await collectMediaFiles(absolute)) files.add(filePath)
      } else if (stats.isFile() && assetMediaType(absolute)) {
        files.add(absolute)
      }
    } catch {
      missingScopes.push(relativeScope)
    }
  }

  if (missingScopes.length) {
    try {
      if (!(await stat(root)).isDirectory()) return null
    } catch {
      return null
    }
    const marked = store.finishIncrementalScan(pack.id, missingScopes, [])
    if (!marked.ok) throw new Error(marked.error.message)
  }

  const sortedFiles = [...files].sort((left, right) => left.localeCompare(right))
  const seenIds: string[] = []
  let importedAssets = 0
  let updatedAssets = 0
  let failedAssets = 0
  for (let index = 0; index < sortedFiles.length; index += 1) {
    try {
      const saved = await scanMediaFile(
        store,
        pack,
        sortedFiles[index],
        index,
        sortedFiles.length,
        emit
      )
      seenIds.push(saved.id)
      if (saved.created) importedAssets += 1
      else updatedAssets += 1
      if (saved.probeFailed) failedAssets += 1
    } catch {
      failedAssets += 1
    }
  }
  try {
    if (!(await stat(root)).isDirectory()) return null
  } catch {
    return null
  }
  const finished = store.finishIncrementalScan(pack.id, scopes, seenIds)
  if (!finished.ok) throw new Error(finished.error.message)
  const result = scanResult(
    pack.id,
    sortedFiles.length,
    importedAssets,
    updatedAssets,
    finished.value,
    failedAssets
  )
  emit?.({ type: 'scan-completed', result })
  return result
}
