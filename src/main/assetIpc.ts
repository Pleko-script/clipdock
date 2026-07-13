import { statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { app, dialog, ipcMain, shell, type IpcMainEvent, type WebContents } from 'electron'
import { SUPPORTED_AUDIO_EXTENSIONS, SUPPORTED_VIDEO_EXTENSIONS } from '../shared/clipdock'
import { assetInvokeChannels, assetIpcChannels as channels } from '../shared/ipcChannels'
import type { AssetJobEvent, AssetScanResult, ClipdockResult } from '../shared/clipdock'
import icon from '../../resources/icon.png?asset'
import { generateAssetPreview } from './assetPreview'
import { generateTrimmedAsset } from './assetTrim'
import {
  parseAssetDragRequest,
  parseAssetQuery,
  parseSmartCollectionSave,
  parseAssetTrim,
  parseAssetUpdate,
  validAssetId,
  validAssetIds,
  validLabel
} from './assetIpcValidation'
import { scanAssetPack } from './assetScanner'
import { openAssetStore, type AssetStore } from './assetStore'

const VIDEO_EXTENSIONS = new Set<string>(SUPPORTED_VIDEO_EXTENSIONS)
const AUDIO_EXTENSIONS = new Set<string>(SUPPORTED_AUDIO_EXTENSIONS)

interface AssetRuntime {
  store: AssetStore
  previewCacheDir: string
  trimCacheDir: string
}

export interface AssetIpcRegistration {
  dispose: () => void
  resolveAssetPath: (
    assetId: string,
    kind: 'media' | 'thumbnail' | 'preview'
  ) => ClipdockResult<string>
}

function ok<T>(value: T): ClipdockResult<T> {
  return { ok: true, value }
}

function fail<T>(
  message: string,
  phase: 'asset' | 'scan' | 'drag' | 'update' = 'asset'
): ClipdockResult<T> {
  return {
    ok: false,
    error: { code: phase === 'drag' ? 'DRAG_FAILED' : 'LIBRARY_PERSIST_FAILED', phase, message }
  }
}

export function registerAssetIpc(): AssetIpcRegistration {
  const root = join(app.getPath('userData'), 'clipdock-library')
  const opened = openAssetStore({
    databaseFile: join(root, 'library.sqlite'),
    previewCacheDir: join(root, 'asset-previews')
  })
  if (!opened.ok) throw new Error(opened.error.message)
  const runtime: AssetRuntime = {
    store: opened.value,
    previewCacheDir: join(root, 'asset-previews'),
    trimCacheDir: join(root, 'trimmed-assets')
  }
  let disposed = false
  let workerRunning = false
  let scanRunning = false
  const trimsRunning = new Set<string>()
  const send = (sender: WebContents | null, event: AssetJobEvent): void => {
    if (sender && !sender.isDestroyed()) sender.send(channels.jobEvent, event)
  }

  const removeStalePreview = async (
    previous: ClipdockResult<string>,
    replacement: string | null
  ): Promise<void> => {
    if (!previous.ok || !replacement) return
    const oldPath = resolve(previous.value)
    const cacheRoot = `${resolve(runtime.previewCacheDir)}${sep}`
    if (oldPath !== resolve(replacement) && oldPath.startsWith(cacheRoot)) {
      try {
        await rm(oldPath, { force: true })
      } catch {
        // A valid new preview must not be failed by best-effort cache cleanup.
      }
    }
  }

  const removeTrimCacheFile = async (
    filePath: string | null,
    replacement: string | null = null
  ): Promise<void> => {
    if (!filePath) return
    const oldPath = resolve(filePath)
    const cacheRoot = `${resolve(runtime.trimCacheDir)}${sep}`
    if (oldPath === (replacement ? resolve(replacement) : null) || !oldPath.startsWith(cacheRoot))
      return
    await rm(oldPath, { force: true }).catch(() => undefined)
  }

  const pumpPreviews = async (sender: WebContents | null): Promise<void> => {
    if (disposed || workerRunning) return
    workerRunning = true
    try {
      while (!disposed) {
        const claimed = runtime.store.claimPreviewJobs(2)
        if (!claimed.ok || claimed.value.length === 0) break
        await Promise.all(
          claimed.value.map(async (job, index) => {
            const asset = runtime.store.getAsset(job.assetId)
            if (!asset.ok) {
              runtime.store.failPreview(job.assetId, asset.error.message)
              send(sender, {
                type: 'preview-failed',
                assetId: job.assetId,
                message: asset.error.message
              })
              return
            }
            try {
              const previousThumbnail = runtime.store.resolveAssetPath(job.assetId, 'thumbnail')
              const previousPreview = runtime.store.resolveAssetPath(job.assetId, 'preview')
              const result = await generateAssetPreview(asset.value, runtime.previewCacheDir)
              const completed = runtime.store.completePreview(
                job.assetId,
                result.thumbnailPath,
                result.previewPath
              )
              if (!completed.ok) throw new Error(completed.error.message)
              await Promise.all([
                removeStalePreview(previousThumbnail, result.thumbnailPath),
                removeStalePreview(previousPreview, result.previewPath)
              ])
              send(sender, {
                type: 'preview-progress',
                assetId: job.assetId,
                completed: index + 1,
                total: claimed.value.length
              })
              send(sender, { type: 'preview-completed', assetId: job.assetId })
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Preview generation failed.'
              runtime.store.failPreview(job.assetId, message)
              send(sender, { type: 'preview-failed', assetId: job.assetId, message })
            }
          })
        )
      }
    } finally {
      workerRunning = false
    }
  }

  const scanPacksUnlocked = async (
    packIds: string[],
    sender: WebContents
  ): Promise<ClipdockResult<AssetScanResult[]>> => {
    const listed = runtime.store.listPacks(packIds)
    if (!listed.ok) return listed
    const results: AssetScanResult[] = []
    for (const pack of listed.value) {
      results.push(await scanAssetPack(runtime.store, pack, (event) => send(sender, event)))
    }
    void pumpPreviews(sender)
    return ok(results)
  }

  const withScanLock = async <T>(
    operation: () => Promise<ClipdockResult<T>>
  ): Promise<ClipdockResult<T>> => {
    if (scanRunning) return fail('A pack scan is already running.', 'scan')
    scanRunning = true
    try {
      return await operation()
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Pack scan failed.', 'scan')
    } finally {
      scanRunning = false
    }
  }

  const firstScanResult = (
    scanned: ClipdockResult<AssetScanResult[]>,
    emptyMessage: string
  ): ClipdockResult<AssetScanResult> => {
    if (!scanned.ok) return fail(scanned.error.message, 'scan')
    return scanned.value[0] ? ok(scanned.value[0]) : fail(emptyMessage, 'scan')
  }

  for (const channel of assetInvokeChannels) ipcMain.removeHandler(channel)
  ipcMain.removeAllListeners(channels.startDrag)

  ipcMain.handle(channels.navigation, () => runtime.store.navigation())
  ipcMain.handle(channels.query, (_event, query: unknown) =>
    runtime.store.queryAssets(parseAssetQuery(query))
  )
  ipcMain.handle(channels.addPack, async (event) => {
    const selected = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Add effect pack'
    })
    if (selected.canceled || !selected.filePaths[0])
      return fail<AssetScanResult>('Pack selection was cancelled.', 'scan')
    return withScanLock(async () => {
      const created = runtime.store.createPack(selected.filePaths[0])
      if (!created.ok) return fail(created.error.message, 'scan')
      const scanned = await scanPacksUnlocked([created.value], event.sender)
      return firstScanResult(scanned, 'Pack scan returned no result.')
    })
  })
  ipcMain.handle(channels.relinkPack, async (event, rawPackId: unknown) => {
    const packId = validAssetId(rawPackId)
    if (!packId) return fail<AssetScanResult>('Asset pack was not found.', 'scan')
    const packs = runtime.store.listPacks([packId])
    if (!packs.ok || !packs.value[0])
      return packs.ok ? fail<AssetScanResult>('Asset pack was not found.', 'scan') : packs
    const selected = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: `Relink ${packs.value[0].name}`
    })
    if (selected.canceled || !selected.filePaths[0])
      return fail<AssetScanResult>('Pack relink was cancelled.', 'scan')
    return withScanLock(async () => {
      const relinked = runtime.store.relinkPack(packId, selected.filePaths[0])
      if (!relinked.ok) return fail(relinked.error.message, 'scan')
      const scanned = await scanPacksUnlocked([packId], event.sender)
      return firstScanResult(scanned, 'Relink scan returned no result.')
    })
  })
  ipcMain.handle(channels.rescanPacks, (event, packIds: unknown) =>
    withScanLock(() => scanPacksUnlocked(validAssetIds(packIds), event.sender))
  )
  ipcMain.handle(channels.updateAssets, (_event, request: unknown) =>
    runtime.store.updateAssets(parseAssetUpdate(request))
  )
  ipcMain.handle(channels.setTrim, async (_event, rawRequest: unknown) => {
    const request = parseAssetTrim(rawRequest)
    if (!request.assetId) return fail<void>('Asset was not found.', 'update')
    if (trimsRunning.has(request.assetId))
      return fail<void>('This video edit is already being prepared.', 'update')

    if (request.startMs === null && request.endMs === null && request.rotationDegrees === 0) {
      const cleared = runtime.store.clearTrim(request.assetId)
      if (!cleared.ok) return cleared
      await removeTrimCacheFile(cleared.value)
      return ok(undefined)
    }
    if ((request.startMs === null || request.endMs === null) && request.startMs !== request.endMs)
      return fail<void>('Both trim handles must define a valid range.', 'update')

    trimsRunning.add(request.assetId)
    const begun = runtime.store.beginTrim(
      request.assetId,
      request.startMs,
      request.endMs,
      request.rotationDegrees
    )
    if (!begun.ok) {
      trimsRunning.delete(request.assetId)
      return begun
    }
    try {
      const renderStartMs = request.startMs ?? 0
      const renderEndMs = request.endMs ?? begun.value.durationMs
      const trimmedPath = await generateTrimmedAsset(
        begun.value,
        renderStartMs,
        renderEndMs,
        request.rotationDegrees,
        runtime.trimCacheDir
      )
      const completed = runtime.store.completeTrim(
        request.assetId,
        request.startMs,
        request.endMs,
        request.rotationDegrees,
        trimmedPath
      )
      if (!completed.ok) {
        await removeTrimCacheFile(trimmedPath)
        return completed
      }
      await removeTrimCacheFile(begun.value.previousTrimmedPath, trimmedPath)
      return ok(undefined)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The video edit could not be built.'
      const reason = detail.trim().split(/\r?\n/).at(-1) || detail
      const message = `ClipDock could not render this video edit. ${reason}`.slice(0, 1000)
      runtime.store.failTrim(
        request.assetId,
        request.startMs,
        request.endMs,
        request.rotationDegrees,
        message
      )
      return fail<void>(message, 'update')
    } finally {
      trimsRunning.delete(request.assetId)
    }
  })
  ipcMain.handle(channels.toggleFavorite, (_event, assetId: unknown) =>
    runtime.store.toggleFavorite(validAssetId(assetId))
  )
  ipcMain.handle(channels.createCollection, (_event, name: unknown) =>
    runtime.store.createCollection(validLabel(name))
  )
  ipcMain.handle(channels.renameCollection, (_event, id: unknown, name: unknown) =>
    runtime.store.renameCollection(validAssetId(id), validLabel(name))
  )
  ipcMain.handle(channels.deleteCollection, (_event, id: unknown) =>
    runtime.store.deleteCollection(validAssetId(id))
  )
  ipcMain.handle(channels.addToCollection, (_event, ids: unknown, collectionId: unknown) =>
    runtime.store.addAssetsToCollection(validAssetIds(ids), validAssetId(collectionId))
  )
  ipcMain.handle(channels.saveSmartCollection, (_event, request: unknown) =>
    runtime.store.saveSmartCollection(parseSmartCollectionSave(request))
  )
  ipcMain.handle(channels.deleteSmartCollection, (_event, id: unknown) =>
    runtime.store.deleteSmartCollection(validAssetId(id))
  )
  ipcMain.handle(channels.reveal, (_event, assetId: unknown) => {
    const asset = runtime.store.getAssetPath(validAssetId(assetId))
    if (!asset.ok) return asset
    shell.showItemInFolder(asset.value.filePath)
    return ok(undefined)
  })
  ipcMain.handle(channels.regeneratePreviews, (event, ids: unknown) => {
    const queued = runtime.store.enqueuePreview(validAssetIds(ids), 20)
    if (queued.ok) void pumpPreviews(event.sender)
    return queued
  })
  ipcMain.on(channels.startDrag, (event: IpcMainEvent, request: unknown) => {
    const { assetIds } = parseAssetDragRequest(request)
    try {
      const trimmedAssetIds: string[] = []
      const files = assetIds.map((id) => {
        const asset = runtime.store.getAssetPath(id)
        if (!asset.ok) throw new Error(asset.error.message)
        if (asset.value.status !== 'ready') throw new Error('Asset is not available for dragging.')
        let selectedPath = asset.value.filePath
        const usingPreparedVideo =
          asset.value.trimStartMs !== null || asset.value.rotationDegrees !== 0
        if (usingPreparedVideo) {
          if (asset.value.trimStatus !== 'ready' || !asset.value.trimmedPath)
            throw new Error('Prepare the selected video edit before dragging it.')
          const trimmedPath = resolve(asset.value.trimmedPath)
          if (!trimmedPath.startsWith(`${resolve(runtime.trimCacheDir)}${sep}`))
            throw new Error('The prepared video edit has an invalid cache path.')
          selectedPath = trimmedPath
          trimmedAssetIds.push(id)
        }
        const filePath = normalize(selectedPath)
        const extension = extname(filePath).toLocaleLowerCase('en-US')
        const supported =
          asset.value.mediaType === 'audio'
            ? AUDIO_EXTENSIONS.has(extension)
            : VIDEO_EXTENSIONS.has(extension)
        if (!supported) throw new Error('Asset format is not supported for dragging.')
        try {
          if (!statSync(filePath).isFile()) throw new Error()
        } catch {
          throw new Error(
            usingPreparedVideo
              ? 'The prepared video is missing. Rebuild it in the editor.'
              : 'Asset file is missing.'
          )
        }
        return filePath
      })
      if (!files.length) throw new Error('Select at least one asset.')
      const dragItem: Parameters<WebContents['startDrag']>[0] = { file: files[0], icon }
      if (files.length > 1) dragItem.files = files
      event.sender.startDrag(dragItem)
      const usage = runtime.store.recordAssetUsage(assetIds)
      if (!usage.ok)
        console.error('[clipdock] asset usage could not be saved:', usage.error.message)
      event.sender.send(channels.dragEvent, { type: 'drag-started', assetIds, trimmedAssetIds })
    } catch (error) {
      event.sender.send(channels.dragEvent, {
        type: 'drag-failed',
        assetIds,
        error: {
          code: 'DRAG_FAILED',
          phase: 'drag',
          message: error instanceof Error ? error.message : 'Native drag failed.'
        }
      })
    }
  })

  setImmediate(() => void pumpPreviews(null))

  return {
    dispose: () => {
      disposed = true
      for (const channel of assetInvokeChannels) ipcMain.removeHandler(channel)
      ipcMain.removeAllListeners(channels.startDrag)
      runtime.store.close()
    },
    resolveAssetPath: (assetId, kind) => runtime.store.resolveAssetPath(assetId, kind)
  }
}
