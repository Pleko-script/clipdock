import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AssetDragEvent,
  AssetDragRequest,
  AssetDuplicateVisibilityRequest,
  AssetJobEvent,
  AssetNavigationSnapshot,
  AssetPage,
  AssetPosterRequest,
  AssetQuery,
  AssetScanResult,
  AssetSmartCollectionSaveRequest,
  AssetTrimRequest,
  AssetUpdateRequest,
  ClipdockApi,
  ClipdockResult
} from '../shared/clipdock'
import { assetIpcChannels as channels } from '../shared/ipcChannels'

function ipcFailure<T>(message: string): ClipdockResult<T> {
  return { ok: false, error: { code: 'PRELOAD_IPC_FAILED', message } }
}

function isClipdockResult<T>(value: unknown): value is ClipdockResult<T> {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  const result = value as Record<string, unknown>
  if (result.ok === true) return 'value' in result
  if (result.ok !== false || typeof result.error !== 'object' || result.error === null) return false
  const error = result.error as Record<string, unknown>
  return typeof error.code === 'string' && typeof error.message === 'string'
}

async function invoke<T>(
  channel: string,
  message: string,
  ...args: unknown[]
): Promise<ClipdockResult<T>> {
  try {
    const result: unknown = await ipcRenderer.invoke(channel, ...args)
    return isClipdockResult<T>(result) ? result : ipcFailure(message)
  } catch {
    return ipcFailure(message)
  }
}

function subscribe<T>(channel: string, listener: (event: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

function limitedIds(ids: string[] | undefined, limit: number): string[] {
  return Array.isArray(ids) ? ids.slice(0, limit) : []
}

const clipdock: ClipdockApi = Object.freeze({
  getNavigationSnapshot: () =>
    invoke<AssetNavigationSnapshot>(channels.navigation, 'ClipDock could not load navigation.'),
  queryAssets: (query: AssetQuery) =>
    invoke<AssetPage>(channels.query, 'ClipDock could not query assets.', query),
  addPackFolder: () =>
    invoke<AssetScanResult>(channels.addPack, 'ClipDock could not add the selected pack.'),
  relinkPack: (packId: string) =>
    invoke<AssetScanResult>(
      channels.relinkPack,
      'ClipDock could not relink the selected pack.',
      packId
    ),
  rescanPacks: (packIds?: string[]) =>
    invoke<AssetScanResult[]>(
      channels.rescanPacks,
      'ClipDock could not rescan packs.',
      limitedIds(packIds, 256)
    ),
  updateAssets: (request: AssetUpdateRequest) =>
    invoke<void>(channels.updateAssets, 'ClipDock could not update assets.', {
      ...request,
      assetIds: limitedIds(request?.assetIds, 256)
    }),
  setDuplicateVisibility: (request: AssetDuplicateVisibilityRequest) =>
    invoke<void>(
      channels.setDuplicateVisibility,
      'ClipDock could not update duplicate visibility.',
      { ...request, assetIds: limitedIds(request?.assetIds, 256) }
    ),
  setAssetTrim: (request: AssetTrimRequest) =>
    invoke<void>(channels.setTrim, 'ClipDock could not prepare the selected range.', request),
  setAssetPoster: (request: AssetPosterRequest) =>
    invoke<void>(channels.setPoster, 'ClipDock could not save the poster frame.', request),
  toggleAssetFavorite: (assetId: string) =>
    invoke<void>(channels.toggleFavorite, 'ClipDock could not update the favorite.', assetId),
  createCollection: (name: string) =>
    invoke<void>(channels.createCollection, 'ClipDock could not create the collection.', name),
  renameCollection: (collectionId: string, name: string) =>
    invoke<void>(
      channels.renameCollection,
      'ClipDock could not rename the collection.',
      collectionId,
      name
    ),
  deleteCollection: (collectionId: string) =>
    invoke<void>(
      channels.deleteCollection,
      'ClipDock could not delete the collection.',
      collectionId
    ),
  addAssetsToCollection: (assetIds: string[], collectionId: string) =>
    invoke<void>(
      channels.addToCollection,
      'ClipDock could not update the collection.',
      limitedIds(assetIds, 256),
      collectionId
    ),
  saveSmartCollection: (request: AssetSmartCollectionSaveRequest) =>
    invoke<void>(
      channels.saveSmartCollection,
      'ClipDock could not save the Smart Collection.',
      request
    ),
  deleteSmartCollection: (smartCollectionId: string) =>
    invoke<void>(
      channels.deleteSmartCollection,
      'ClipDock could not delete the Smart Collection.',
      smartCollectionId
    ),
  revealAsset: (assetId: string) =>
    invoke<void>(channels.reveal, 'ClipDock could not reveal the asset.', assetId),
  regeneratePreviews: (assetIds: string[]) =>
    invoke<void>(
      channels.regeneratePreviews,
      'ClipDock could not regenerate previews.',
      limitedIds(assetIds, 256)
    ),
  startAssetDrag: (request: AssetDragRequest): void => {
    ipcRenderer.send(channels.startDrag, { assetIds: limitedIds(request?.assetIds, 32) })
  },
  onAssetJobEvent: (listener: (event: AssetJobEvent) => void) =>
    subscribe(channels.jobEvent, listener),
  onAssetDragEvent: (listener: (event: AssetDragEvent) => void) =>
    subscribe(channels.dragEvent, listener)
})

contextBridge.exposeInMainWorld('clipdock', clipdock)
