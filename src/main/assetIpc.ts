import { statSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'
import { app, dialog, ipcMain, shell, type IpcMainEvent, type WebContents } from 'electron'
import type {
  AssetDragRequest,
  AssetJobEvent,
  AssetQuery,
  AssetScanResult,
  AssetUpdateRequest,
  ClipdockResult,
  LibraryResult
} from '../shared/clipdock'
import icon from '../../resources/icon.png?asset'
import { generateAssetPreview } from './assetPreview'
import { scanAssetPack } from './assetScanner'
import { openAssetStore, type AssetStore } from './assetStore'

const GET_ASSET_NAVIGATION_CHANNEL = 'clipdock:assets:get-navigation'
const QUERY_ASSETS_CHANNEL = 'clipdock:assets:query'
const ADD_PACK_FOLDER_CHANNEL = 'clipdock:assets:add-pack'
const RELINK_PACK_CHANNEL = 'clipdock:assets:relink-pack'
const RESCAN_PACKS_CHANNEL = 'clipdock:assets:rescan-packs'
const UPDATE_ASSETS_CHANNEL = 'clipdock:assets:update'
const TOGGLE_ASSET_FAVORITE_CHANNEL = 'clipdock:assets:toggle-favorite'
const CREATE_COLLECTION_CHANNEL = 'clipdock:assets:create-collection'
const RENAME_COLLECTION_CHANNEL = 'clipdock:assets:rename-collection'
const DELETE_COLLECTION_CHANNEL = 'clipdock:assets:delete-collection'
const ADD_ASSETS_TO_COLLECTION_CHANNEL = 'clipdock:assets:add-to-collection'
const REVEAL_ASSET_CHANNEL = 'clipdock:assets:reveal'
const REGENERATE_PREVIEWS_CHANNEL = 'clipdock:assets:regenerate-previews'
const PREPARE_ASSET_DRAG_CHANNEL = 'clipdock:assets:prepare-drag'
const START_ASSET_DRAG_CHANNEL = 'clipdock:assets:start-drag'
const ASSET_JOB_EVENT_CHANNEL = 'clipdock:assets:job-event'
const ASSET_DRAG_EVENT_CHANNEL = 'clipdock:assets:drag-event'

const INVOKE_CHANNELS = [
  GET_ASSET_NAVIGATION_CHANNEL,
  QUERY_ASSETS_CHANNEL,
  ADD_PACK_FOLDER_CHANNEL,
  RELINK_PACK_CHANNEL,
  RESCAN_PACKS_CHANNEL,
  UPDATE_ASSETS_CHANNEL,
  TOGGLE_ASSET_FAVORITE_CHANNEL,
  CREATE_COLLECTION_CHANNEL,
  RENAME_COLLECTION_CHANNEL,
  DELETE_COLLECTION_CHANNEL,
  ADD_ASSETS_TO_COLLECTION_CHANNEL,
  REVEAL_ASSET_CHANNEL,
  REGENERATE_PREVIEWS_CHANNEL,
  PREPARE_ASSET_DRAG_CHANNEL
] as const

interface AssetRuntime {
  store: AssetStore
  previewCacheDir: string
}

export interface AssetIpcRegistration {
  dispose: () => void
  resolveAssetPath: (
    assetId: string,
    kind: 'media' | 'thumbnail' | 'preview'
  ) => LibraryResult<string>
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

function validIds(value: unknown, limit = 256): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        )
      ].slice(0, limit)
    : []
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
    previewCacheDir: join(root, 'asset-previews')
  }
  let disposed = false
  let workerRunning = false
  const send = (sender: WebContents | null, event: AssetJobEvent): void => {
    if (sender && !sender.isDestroyed()) sender.send(ASSET_JOB_EVENT_CHANNEL, event)
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
            if (!asset.ok) return
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

  const scanPacks = async (
    packIds: string[],
    sender: WebContents
  ): Promise<ClipdockResult<AssetScanResult[]>> => {
    const listed = runtime.store.listPacks(packIds)
    if (!listed.ok) return listed
    const results: AssetScanResult[] = []
    for (const pack of listed.value) {
      try {
        results.push(await scanAssetPack(runtime.store, pack, (event) => send(sender, event)))
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'Pack scan failed.', 'scan')
      }
    }
    void pumpPreviews(sender)
    return ok(results)
  }

  for (const channel of INVOKE_CHANNELS) ipcMain.removeHandler(channel)
  ipcMain.removeAllListeners(START_ASSET_DRAG_CHANNEL)

  ipcMain.handle(GET_ASSET_NAVIGATION_CHANNEL, () => runtime.store.navigation())
  ipcMain.handle(QUERY_ASSETS_CHANNEL, (_event, query: AssetQuery) =>
    runtime.store.queryAssets(query ?? {})
  )
  ipcMain.handle(ADD_PACK_FOLDER_CHANNEL, async (event) => {
    const selected = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Add effect pack'
    })
    if (selected.canceled || !selected.filePaths[0])
      return fail<AssetScanResult>('Pack selection was cancelled.', 'scan')
    const created = runtime.store.createPack(selected.filePaths[0])
    if (!created.ok) return created
    const scanned = await scanPacks([created.value], event.sender)
    return scanned.ok && scanned.value[0] ? ok(scanned.value[0]) : scanned
  })
  ipcMain.handle(RELINK_PACK_CHANNEL, async (event, packId: string) => {
    const packs = runtime.store.listPacks([packId])
    if (!packs.ok || !packs.value[0])
      return packs.ok ? fail<AssetScanResult>('Asset pack was not found.', 'scan') : packs
    const selected = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: `Relink ${packs.value[0].name}`
    })
    if (selected.canceled || !selected.filePaths[0])
      return fail<AssetScanResult>('Pack relink was cancelled.', 'scan')
    const relinked = runtime.store.relinkPack(packId, selected.filePaths[0])
    if (!relinked.ok) return relinked
    const scanned = await scanPacks([packId], event.sender)
    return scanned.ok && scanned.value[0]
      ? ok(scanned.value[0])
      : fail<AssetScanResult>(
          scanned.ok ? 'Relink scan returned no result.' : scanned.error.message,
          'scan'
        )
  })
  ipcMain.handle(RESCAN_PACKS_CHANNEL, (event, packIds: unknown) =>
    scanPacks(validIds(packIds), event.sender)
  )
  ipcMain.handle(UPDATE_ASSETS_CHANNEL, (_event, request: AssetUpdateRequest) =>
    runtime.store.updateAssets({
      ...request,
      assetIds: validIds(request?.assetIds)
    })
  )
  ipcMain.handle(TOGGLE_ASSET_FAVORITE_CHANNEL, (_event, assetId: string) =>
    runtime.store.toggleFavorite(assetId)
  )
  ipcMain.handle(CREATE_COLLECTION_CHANNEL, (_event, name: string) =>
    runtime.store.createCollection(typeof name === 'string' ? name : '')
  )
  ipcMain.handle(RENAME_COLLECTION_CHANNEL, (_event, id: string, name: string) =>
    runtime.store.renameCollection(id, typeof name === 'string' ? name : '')
  )
  ipcMain.handle(DELETE_COLLECTION_CHANNEL, (_event, id: string) =>
    runtime.store.deleteCollection(id)
  )
  ipcMain.handle(ADD_ASSETS_TO_COLLECTION_CHANNEL, (_event, ids: unknown, collectionId: string) =>
    runtime.store.addAssetsToCollection(validIds(ids), collectionId)
  )
  ipcMain.handle(REVEAL_ASSET_CHANNEL, (_event, assetId: string) => {
    const asset = runtime.store.getAssetPath(assetId)
    if (!asset.ok) return asset
    shell.showItemInFolder(asset.value.filePath)
    return ok(undefined)
  })
  ipcMain.handle(REGENERATE_PREVIEWS_CHANNEL, (event, ids: unknown) => {
    const queued = runtime.store.enqueuePreview(validIds(ids), 20)
    if (queued.ok) void pumpPreviews(event.sender)
    return queued
  })
  ipcMain.handle(PREPARE_ASSET_DRAG_CHANNEL, async (_event, request: AssetDragRequest) => {
    const ids = validIds(request?.assetIds, 32)
    if (!ids.length) return fail('Select at least one asset.', 'drag')
    for (const id of ids) {
      const asset = runtime.store.getAssetPath(id)
      if (!asset.ok) return asset
      try {
        if (!(await stat(asset.value.filePath)).isFile())
          return fail('Asset file is missing.', 'drag')
      } catch {
        return fail('Asset file is missing.', 'drag')
      }
    }
    return ok(undefined)
  })

  ipcMain.on(START_ASSET_DRAG_CHANNEL, (event: IpcMainEvent, request: AssetDragRequest) => {
    const assetIds = validIds(request?.assetIds, 32)
    try {
      const files = assetIds.map((id) => {
        const asset = runtime.store.getAssetPath(id)
        if (!asset.ok) throw new Error(asset.error.message)
        const filePath = normalize(asset.value.filePath)
        if (!statSync(filePath).isFile()) throw new Error('Asset file is missing.')
        return filePath
      })
      if (!files.length) throw new Error('Select at least one asset.')
      const dragItem: Parameters<WebContents['startDrag']>[0] = { file: files[0], icon }
      if (files.length > 1) dragItem.files = files
      event.sender.startDrag(dragItem)
      event.sender.send(ASSET_DRAG_EVENT_CHANNEL, { type: 'drag-started', assetIds })
    } catch (error) {
      event.sender.send(ASSET_DRAG_EVENT_CHANNEL, {
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
      for (const channel of INVOKE_CHANNELS) ipcMain.removeHandler(channel)
      ipcMain.removeAllListeners(START_ASSET_DRAG_CHANNEL)
      runtime.store.close()
    },
    resolveAssetPath: (assetId, kind) => {
      const result = runtime.store.resolveAssetPath(assetId, kind)
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, error: { ...result.error, phase: result.error.phase ?? 'asset' } }
    }
  }
}
