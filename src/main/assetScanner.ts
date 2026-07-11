import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
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
    const filePath = files[index]
    emit?.({
      type: 'scan-progress',
      packId: pack.id,
      currentFile: filePath,
      completed: index,
      total: files.length
    })
    try {
      const stats = await stat(filePath)
      const mediaType = assetMediaType(filePath)
      if (!mediaType) continue
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
        failedAssets += 1
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
      seenIds.push(saved.value.id)
      if (saved.value.created) importedAssets += 1
      else updatedAssets += 1
    } catch {
      failedAssets += 1
    }
  }

  const finished = store.finishPackScan(pack.id, seenIds)
  if (!finished.ok) throw new Error(finished.error.message)
  const result: AssetScanResult = {
    packId: pack.id,
    scannedFiles: files.length,
    importedAssets,
    updatedAssets,
    missingAssets: finished.value,
    failedAssets
  }
  emit?.({ type: 'scan-completed', result })
  return result
}
