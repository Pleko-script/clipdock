import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  ClipdockApi,
  ClipdockResult,
  ClipDragEvent,
  ClipDragRequest,
  LibraryImportResult,
  LibrarySnapshot,
  ScanEvent,
  ScanResult
} from '../shared/clipdock'

const GET_LIBRARY_SNAPSHOT_CHANNEL = 'clipdock:library:get-snapshot'
const ADD_LINKED_FOLDER_CHANNEL = 'clipdock:library:add-linked-folder'
const COPY_VIDEOS_INTO_LIBRARY_CHANNEL = 'clipdock:library:copy-videos-into-library'
const RESCAN_LIBRARY_CHANNEL = 'clipdock:library:rescan'
const TOGGLE_FAVORITE_CHANNEL = 'clipdock:clip:toggle-favorite'
const UPDATE_CLIP_TAGS_CHANNEL = 'clipdock:clip:update-tags'
const UPDATE_CLIP_NOTE_CHANNEL = 'clipdock:clip:update-note'
const REVEAL_CLIP_CHANNEL = 'clipdock:clip:reveal'
const COPY_CLIP_PATH_CHANNEL = 'clipdock:clip:copy-path'
const START_CLIP_DRAG_CHANNEL = 'clipdock:clip:start-drag'
const SCAN_EVENT_CHANNEL = 'clipdock:library:scan-event'
const CLIP_DRAG_EVENT_CHANNEL = 'clipdock:clip:drag-event'

function createPreloadIpcFailure<T>(message: string): ClipdockResult<T> {
  return {
    ok: false,
    error: {
      code: 'PRELOAD_IPC_FAILED',
      message
    }
  }
}

function isClipdockResult<T>(value: unknown): value is ClipdockResult<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    ((value as { ok: unknown }).ok === true || (value as { ok: unknown }).ok === false)
  )
}

async function invokeClipdock<T>(
  channel: string,
  message: string,
  ...args: unknown[]
): Promise<ClipdockResult<T>> {
  try {
    const result = await ipcRenderer.invoke(channel, ...args)

    if (isClipdockResult<T>(result)) {
      return result
    }
  } catch {
    return createPreloadIpcFailure(message)
  }

  return createPreloadIpcFailure(message)
}

function subscribe<T>(channel: string, listener: (event: T) => void): () => void {
  if (typeof listener !== 'function') {
    return (): void => {}
  }

  const handler = (_event: IpcRendererEvent, payload: T): void => {
    listener(payload)
  }

  ipcRenderer.on(channel, handler)

  return (): void => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const clipdock: ClipdockApi = Object.freeze({
  getLibrarySnapshot: (): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(
      GET_LIBRARY_SNAPSHOT_CHANNEL,
      'ClipDock could not load the library.'
    )
  },
  addLinkedFolder: (): Promise<ClipdockResult<ScanResult>> => {
    return invokeClipdock<ScanResult>(
      ADD_LINKED_FOLDER_CHANNEL,
      'ClipDock could not add and scan the selected folder.'
    )
  },
  copyVideosIntoLibrary: (): Promise<ClipdockResult<LibraryImportResult>> => {
    return invokeClipdock<LibraryImportResult>(
      COPY_VIDEOS_INTO_LIBRARY_CHANNEL,
      'ClipDock could not copy videos into the library.'
    )
  },
  rescanLibrary: (): Promise<ClipdockResult<ScanResult>> => {
    return invokeClipdock<ScanResult>(
      RESCAN_LIBRARY_CHANNEL,
      'ClipDock could not rescan the library.'
    )
  },
  toggleFavorite: (clipId: string): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(
      TOGGLE_FAVORITE_CHANNEL,
      'ClipDock could not update the favorite state.',
      clipId
    )
  },
  updateClipTags: (clipId: string, tags: string[]): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(
      UPDATE_CLIP_TAGS_CHANNEL,
      'ClipDock could not update tags.',
      clipId,
      tags
    )
  },
  updateClipNote: (clipId: string, note: string): Promise<ClipdockResult<LibrarySnapshot>> => {
    return invokeClipdock<LibrarySnapshot>(
      UPDATE_CLIP_NOTE_CHANNEL,
      'ClipDock could not update the note.',
      clipId,
      note
    )
  },
  revealClip: (clipId: string): Promise<ClipdockResult<void>> => {
    return invokeClipdock<void>(REVEAL_CLIP_CHANNEL, 'ClipDock could not reveal the clip.', clipId)
  },
  copyClipPath: (clipId: string): Promise<ClipdockResult<void>> => {
    return invokeClipdock<void>(
      COPY_CLIP_PATH_CHANNEL,
      'ClipDock could not copy the clip path.',
      clipId
    )
  },
  startClipDrag: (request: ClipDragRequest): void => {
    ipcRenderer.send(START_CLIP_DRAG_CHANNEL, {
      clipIds: Array.isArray(request?.clipIds) ? request.clipIds.slice(0, 32) : []
    })
  },
  onScanEvent: (listener: (event: ScanEvent) => void): (() => void) => {
    return subscribe<ScanEvent>(SCAN_EVENT_CHANNEL, listener)
  },
  onClipDragEvent: (listener: (event: ClipDragEvent) => void): (() => void) => {
    return subscribe<ClipDragEvent>(CLIP_DRAG_EVENT_CHANNEL, listener)
  }
})

contextBridge.exposeInMainWorld('clipdock', clipdock)
