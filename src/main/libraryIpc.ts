import { randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { access, copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join, parse } from 'node:path'
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  shell,
  type IpcMainEvent,
  type WebContents
} from 'electron'
import {
  SUPPORTED_VIDEO_EXTENSIONS,
  type ClipdockError,
  type ClipdockErrorCode,
  type ClipdockResult,
  type ClipDragRequest,
  type LibraryFailure,
  type LibraryImportPhase,
  type LibraryImportResult,
  type LibraryImportSummary,
  type LibraryResult,
  type LibrarySnapshot,
  type ScanEvent,
  type ScanResult,
  type SupportedVideoExtension
} from '../shared/clipdock'
import { scanLibrary } from './libraryScanner'
import { openLibraryStore, type LibraryStore } from './libraryStore'
import icon from '../../resources/icon.png?asset'

const GET_LIBRARY_SNAPSHOT_CHANNEL = 'clipdock:library:get-snapshot'
const ADD_LINKED_FOLDER_CHANNEL = 'clipdock:library:add-linked-folder'
const COPY_VIDEOS_INTO_LIBRARY_CHANNEL = 'clipdock:library:copy-videos-into-library'
const RESCAN_LIBRARY_CHANNEL = 'clipdock:library:rescan'
const TOGGLE_FAVORITE_CHANNEL = 'clipdock:clip:toggle-favorite'
const UPDATE_CLIP_TAGS_CHANNEL = 'clipdock:clip:update-tags'
const UPDATE_CLIP_NOTE_CHANNEL = 'clipdock:clip:update-note'
const CREATE_BIN_CHANNEL = 'clipdock:bin:create'
const RENAME_BIN_CHANNEL = 'clipdock:bin:rename'
const DELETE_BIN_CHANNEL = 'clipdock:bin:delete'
const ADD_CLIPS_TO_BIN_CHANNEL = 'clipdock:bin:add-clips'
const MOVE_CLIPS_TO_BIN_CHANNEL = 'clipdock:bin:move-clips'
const REMOVE_CLIPS_FROM_BIN_CHANNEL = 'clipdock:bin:remove-clips'
const REMOVE_CLIPS_FROM_LIBRARY_CHANNEL = 'clipdock:clip:remove-from-library'
const UPDATE_CLIP_ROTATION_CHANNEL = 'clipdock:clip:update-rotation'
const REVEAL_CLIP_CHANNEL = 'clipdock:clip:reveal'
const COPY_CLIP_PATH_CHANNEL = 'clipdock:clip:copy-path'
const START_CLIP_DRAG_CHANNEL = 'clipdock:clip:start-drag'
const SCAN_EVENT_CHANNEL = 'clipdock:library:scan-event'
const CLIP_DRAG_EVENT_CHANNEL = 'clipdock:clip:drag-event'

const LIBRARY_INVOKE_CHANNELS = [
  GET_LIBRARY_SNAPSHOT_CHANNEL,
  ADD_LINKED_FOLDER_CHANNEL,
  COPY_VIDEOS_INTO_LIBRARY_CHANNEL,
  RESCAN_LIBRARY_CHANNEL,
  TOGGLE_FAVORITE_CHANNEL,
  UPDATE_CLIP_TAGS_CHANNEL,
  UPDATE_CLIP_NOTE_CHANNEL,
  CREATE_BIN_CHANNEL,
  RENAME_BIN_CHANNEL,
  DELETE_BIN_CHANNEL,
  ADD_CLIPS_TO_BIN_CHANNEL,
  MOVE_CLIPS_TO_BIN_CHANNEL,
  REMOVE_CLIPS_FROM_BIN_CHANNEL,
  REMOVE_CLIPS_FROM_LIBRARY_CHANNEL,
  UPDATE_CLIP_ROTATION_CHANNEL,
  REVEAL_CLIP_CHANNEL,
  COPY_CLIP_PATH_CHANNEL
] as const

const LIBRARY_ROOT_DIRNAME = 'clipdock-library'
const LIBRARY_DATABASE_FILENAME = 'library.sqlite'
const MANAGED_LIBRARY_DIRNAME = 'managed-media'
const THUMBNAIL_CACHE_DIRNAME = 'thumbnails'
const MAX_LIBRARY_IMPORT_FAILURES = 25
const MANAGED_NAME_ATTEMPT_LIMIT = 100
const VIDEO_FILTER_EXTENSIONS = SUPPORTED_VIDEO_EXTENSIONS.map((extension) => extension.slice(1))

interface LibraryStorageLocations {
  databaseFile: string
  managedLibraryDir: string
  thumbnailCacheDir: string
}

interface LibraryRuntime {
  store: LibraryStore
  storage: LibraryStorageLocations
}

interface LibraryFileSystem {
  access: typeof access
  copyFile: typeof copyFile
  mkdir: typeof mkdir
  rm: typeof rm
  stat: typeof stat
}

export interface LibraryIpcRegistration {
  close: () => ClipdockResult<void>
  dispose: () => ClipdockResult<void>
  resolveAssetPath: (clipId: string, kind: 'media' | 'thumbnail') => LibraryResult<string>
}

export interface LibraryIpcDependencies {
  app?: Pick<typeof app, 'getPath' | 'isReady'>
  dialog?: Pick<typeof dialog, 'showOpenDialog'>
  ipcMain?: Pick<typeof ipcMain, 'handle' | 'removeHandler' | 'on' | 'removeAllListeners'>
  fs?: LibraryFileSystem
  openLibraryStore?: typeof openLibraryStore
  createImportId?: () => string
}

interface ResolvedLibraryIpcDependencies {
  app: Pick<typeof app, 'getPath' | 'isReady'>
  dialog: Pick<typeof dialog, 'showOpenDialog'>
  ipcMain: Pick<typeof ipcMain, 'handle' | 'removeHandler' | 'on' | 'removeAllListeners'>
  fs: LibraryFileSystem
  openLibraryStore: typeof openLibraryStore
  createImportId: () => string
}

interface ImportCounters {
  createdSourceCount: number
  createdClipCount: number
  duplicateSourceCount: number
  duplicateClipCount: number
  skippedCount: number
  failedCount: number
}

let activeLibraryIpc: LibraryIpcRegistration | null = null
let scanRunning = false

function ok<T>(value: T): ClipdockResult<T> {
  return { ok: true, value }
}

function fail<T>(
  code: ClipdockErrorCode,
  message: string,
  details: { phase?: LibraryImportPhase; sourcePath?: string; targetPath?: string } = {}
): ClipdockResult<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details.phase ? { phase: details.phase } : {}),
      ...(details.sourcePath ? { sourcePath: details.sourcePath } : {}),
      ...(details.targetPath ? { targetPath: details.targetPath } : {})
    }
  }
}

function libraryOk<T>(value: T): LibraryResult<T> {
  return { ok: true, value }
}

function libraryFail<T>(
  code: ClipdockErrorCode,
  phase: LibraryImportPhase,
  message: string,
  details: { sourcePath?: string; targetPath?: string } = {}
): LibraryResult<T> {
  return {
    ok: false,
    error: {
      code,
      phase,
      message,
      ...(details.sourcePath ? { sourcePath: details.sourcePath } : {}),
      ...(details.targetPath ? { targetPath: details.targetPath } : {})
    }
  }
}

function fromLibraryResult<T>(result: LibraryResult<T>): ClipdockResult<T> {
  if (result.ok) {
    return ok(result.value)
  }

  return fail(result.error.code, result.error.message, {
    phase: result.error.phase,
    sourcePath: result.error.sourcePath,
    targetPath: result.error.targetPath
  })
}

function resolveDependencies(
  dependencies: LibraryIpcDependencies = {}
): ResolvedLibraryIpcDependencies {
  return {
    app: dependencies.app ?? app,
    dialog: dependencies.dialog ?? dialog,
    ipcMain: dependencies.ipcMain ?? ipcMain,
    fs: dependencies.fs ?? { access, copyFile, mkdir, rm, stat },
    openLibraryStore: dependencies.openLibraryStore ?? openLibraryStore,
    createImportId: dependencies.createImportId ?? randomUUID
  }
}

function removeLibraryHandlers(ipc: ResolvedLibraryIpcDependencies['ipcMain']): void {
  for (const channel of LIBRARY_INVOKE_CHANNELS) {
    ipc.removeHandler(channel)
  }

  ipc.removeAllListeners(START_CLIP_DRAG_CHANNEL)
}

function assertAppReady(application: Pick<typeof app, 'isReady'>): LibraryResult<void> {
  if (!application.isReady()) {
    return libraryFail(
      'LIBRARY_OPEN_FAILED',
      'open',
      'The ClipDock library can be opened only after the app is ready.'
    )
  }

  return libraryOk(undefined)
}

function resolveLibraryStorage(
  application: Pick<typeof app, 'getPath' | 'isReady'>
): LibraryResult<LibraryStorageLocations> {
  const readyResult = assertAppReady(application)

  if (!readyResult.ok) {
    return readyResult
  }

  try {
    const userDataDir = application.getPath('userData')
    const libraryRoot = join(userDataDir, LIBRARY_ROOT_DIRNAME)

    return libraryOk({
      databaseFile: join(libraryRoot, LIBRARY_DATABASE_FILENAME),
      managedLibraryDir: join(libraryRoot, MANAGED_LIBRARY_DIRNAME),
      thumbnailCacheDir: join(libraryRoot, THUMBNAIL_CACHE_DIRNAME)
    })
  } catch {
    return libraryFail(
      'LIBRARY_OPEN_FAILED',
      'open',
      'The ClipDock library storage paths could not be resolved.'
    )
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function getSupportedExtension(fileLocation: string): SupportedVideoExtension | null {
  const extension = extname(fileLocation).toLowerCase()

  if (SUPPORTED_VIDEO_EXTENSIONS.includes(extension as SupportedVideoExtension)) {
    return extension as SupportedVideoExtension
  }

  return null
}

async function readSelectedSourceStats(
  dependencies: ResolvedLibraryIpcDependencies,
  sourcePath: string,
  phase: LibraryImportPhase
): Promise<LibraryResult<Stats>> {
  try {
    return libraryOk(await dependencies.fs.stat(sourcePath))
  } catch (error) {
    if (isErrnoException(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return libraryFail(
        'LIBRARY_MISSING_FILE',
        phase,
        'The selected library item is no longer available.',
        {
          sourcePath
        }
      )
    }

    return libraryFail(
      'LIBRARY_STAT_FAILED',
      phase,
      'The selected library item could not be inspected.',
      {
        sourcePath
      }
    )
  }
}

async function validateLinkedFolderSelection(
  dependencies: ResolvedLibraryIpcDependencies,
  sourcePath: string
): Promise<LibraryResult<string>> {
  const statsResult = await readSelectedSourceStats(dependencies, sourcePath, 'stat-source')

  if (!statsResult.ok) {
    return statsResult
  }

  if (!statsResult.value.isDirectory()) {
    return libraryFail(
      'LIBRARY_NOT_A_DIRECTORY',
      'stat-source',
      'The selected source is not a folder.',
      {
        sourcePath
      }
    )
  }

  return libraryOk(sourcePath)
}

async function validateCopySourceFile(
  dependencies: ResolvedLibraryIpcDependencies,
  sourcePath: string
): Promise<LibraryResult<{ sourcePath: string; extension: SupportedVideoExtension }>> {
  const extension = getSupportedExtension(sourcePath)

  if (!extension) {
    return libraryFail(
      'LIBRARY_UNSUPPORTED_EXTENSION',
      'validate-source',
      'ClipDock supports video files only.',
      {
        sourcePath
      }
    )
  }

  const statsResult = await readSelectedSourceStats(dependencies, sourcePath, 'stat-source')

  if (!statsResult.ok) {
    return statsResult
  }

  if (!statsResult.value.isFile()) {
    return libraryFail('LIBRARY_NOT_A_FILE', 'stat-source', 'The selected item is not a file.', {
      sourcePath
    })
  }

  return libraryOk({ sourcePath, extension })
}

async function ensureManagedLibraryDirectory(
  dependencies: ResolvedLibraryIpcDependencies,
  storage: LibraryStorageLocations
): Promise<LibraryResult<void>> {
  try {
    await dependencies.fs.mkdir(storage.managedLibraryDir, { recursive: true })
    await dependencies.fs.mkdir(storage.thumbnailCacheDir, { recursive: true })
    return libraryOk(undefined)
  } catch {
    return libraryFail(
      'LIBRARY_COPY_FAILED',
      'copy',
      'The ClipDock library directories could not be prepared.',
      {
        targetPath: storage.managedLibraryDir
      }
    )
  }
}

function normalizeRuntimeLocation(location: string): string {
  return process.platform === 'win32' ? location.toLocaleLowerCase('en-US') : location
}

function sanitizeManagedBaseName(sourcePath: string): string {
  const parsed = parse(basename(sourcePath))
  const safeBaseName = [...parsed.name]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0

      return codePoint <= 0x1f || /[<>:"/\\|?*]/.test(character) ? '-' : character
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)

  return safeBaseName.length > 0 ? safeBaseName : 'clip'
}

async function fileExists(
  dependencies: ResolvedLibraryIpcDependencies,
  targetPath: string
): Promise<boolean> {
  try {
    await dependencies.fs.access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function createManagedCopyTarget(
  dependencies: ResolvedLibraryIpcDependencies,
  storage: LibraryStorageLocations,
  sourcePath: string,
  extension: SupportedVideoExtension,
  reservedTargets: Set<string>
): Promise<LibraryResult<string>> {
  const safeBaseName = sanitizeManagedBaseName(sourcePath)

  for (let attempt = 0; attempt < MANAGED_NAME_ATTEMPT_LIMIT; attempt += 1) {
    const suffix = dependencies.createImportId()
    const targetPath = join(storage.managedLibraryDir, `${safeBaseName}-${suffix}${extension}`)
    const normalizedTarget = normalizeRuntimeLocation(targetPath)

    if (reservedTargets.has(normalizedTarget)) {
      continue
    }

    if (await fileExists(dependencies, targetPath)) {
      reservedTargets.add(normalizedTarget)
      continue
    }

    reservedTargets.add(normalizedTarget)
    return libraryOk(targetPath)
  }

  return libraryFail(
    'LIBRARY_TARGET_COLLISION',
    'validate-target',
    'ClipDock could not allocate a managed filename.',
    {
      sourcePath,
      targetPath: storage.managedLibraryDir
    }
  )
}

async function copyFileIntoManagedLibrary(
  dependencies: ResolvedLibraryIpcDependencies,
  sourcePath: string,
  targetPath: string
): Promise<LibraryResult<void>> {
  try {
    await dependencies.fs.copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL)
    return libraryOk(undefined)
  } catch {
    return libraryFail('LIBRARY_COPY_FAILED', 'copy', 'The selected video could not be copied.', {
      sourcePath,
      targetPath
    })
  }
}

async function removeUntrackedManagedCopy(
  dependencies: ResolvedLibraryIpcDependencies,
  targetPath: string
): Promise<void> {
  try {
    await dependencies.fs.rm(targetPath, { force: true })
  } catch {
    // The persist error already tells the renderer that the copy was not imported.
  }
}

function appendBoundedFailure(failures: LibraryFailure[], failure: LibraryFailure): void {
  if (failures.length < MAX_LIBRARY_IMPORT_FAILURES) {
    failures.push(failure)
  }
}

function addSummaryCounts(counters: ImportCounters, summary: LibraryImportSummary): void {
  counters.createdSourceCount += summary.createdSourceCount
  counters.createdClipCount += summary.createdClipCount
  counters.duplicateSourceCount += summary.duplicateSourceCount
  counters.duplicateClipCount += summary.duplicateClipCount
  counters.skippedCount += summary.skippedCount
  counters.failedCount += summary.failedCount
}

function makeCopiedBatchSummary(
  counters: ImportCounters,
  errors: LibraryFailure[]
): LibraryImportSummary {
  const status: LibraryImportSummary['status'] =
    counters.createdClipCount > 0 && counters.failedCount > 0
      ? 'partial'
      : counters.createdClipCount > 0
        ? 'imported'
        : counters.duplicateClipCount > 0 && counters.failedCount === 0
          ? 'duplicate'
          : 'failed'

  return {
    mode: 'copied-file',
    status,
    createdSourceCount: counters.createdSourceCount,
    createdClipCount: counters.createdClipCount,
    duplicateSourceCount: counters.duplicateSourceCount,
    duplicateClipCount: counters.duplicateClipCount,
    skippedCount: counters.skippedCount,
    failedCount: counters.failedCount,
    errors
  }
}

function importResultWithSnapshot(
  runtime: LibraryRuntime,
  summary: LibraryImportSummary
): ClipdockResult<LibraryImportResult> {
  const snapshotResult = runtime.store.snapshot()

  if (!snapshotResult.ok) {
    return fromLibraryResult(snapshotResult)
  }

  return ok({ snapshot: snapshotResult.value, summary })
}

async function showOpenDialog(
  dependencies: ResolvedLibraryIpcDependencies,
  options: Electron.OpenDialogOptions,
  message: string
): Promise<ClipdockResult<Electron.OpenDialogReturnValue>> {
  const readyResult = assertAppReady(dependencies.app)

  if (!readyResult.ok) {
    return fromLibraryResult(readyResult)
  }

  try {
    return ok(await dependencies.dialog.showOpenDialog(options))
  } catch {
    return fail('DIALOG_FAILED', message, { phase: 'dialog' })
  }
}

async function runScan(
  runtime: LibraryRuntime,
  sender?: WebContents
): Promise<ClipdockResult<ScanResult>> {
  if (scanRunning) {
    return fail('SCAN_ALREADY_RUNNING', 'A library scan is already running.', { phase: 'scan' })
  }

  scanRunning = true

  const emit = (event: ScanEvent): void => {
    if (sender && !sender.isDestroyed()) {
      sender.send(SCAN_EVENT_CHANNEL, event)
    }
  }

  try {
    const result = await scanLibrary({
      store: runtime.store,
      thumbnailCacheDir: runtime.storage.thumbnailCacheDir,
      emit
    })

    return ok(result)
  } catch (error) {
    const clipdockError: ClipdockError =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as ClipdockError)
        : { code: 'SCAN_FAILED', phase: 'scan', message: 'ClipDock could not complete the scan.' }

    emit({ type: 'scan-failed', error: clipdockError })
    return fail(clipdockError.code, clipdockError.message, {
      phase: clipdockError.phase,
      sourcePath: clipdockError.sourcePath,
      targetPath: clipdockError.targetPath
    })
  } finally {
    scanRunning = false
  }
}

async function addLinkedFolder(
  dependencies: ResolvedLibraryIpcDependencies,
  ensureRuntime: () => LibraryResult<LibraryRuntime>,
  sender?: WebContents
): Promise<ClipdockResult<ScanResult>> {
  const dialogResult = await showOpenDialog(
    dependencies,
    {
      title: 'Add a ClipDock video folder',
      properties: ['openDirectory']
    },
    'The linked folder picker could not be opened.'
  )

  if (!dialogResult.ok) {
    return dialogResult
  }

  if (dialogResult.value.canceled || dialogResult.value.filePaths.length === 0) {
    return fail('CANCELLED', 'No linked folder was selected.', { phase: 'dialog' })
  }

  const selectedFolder = dialogResult.value.filePaths[0]
  const validation = await validateLinkedFolderSelection(dependencies, selectedFolder)

  if (!validation.ok) {
    return fromLibraryResult(validation)
  }

  const runtimeResult = ensureRuntime()

  if (!runtimeResult.ok) {
    return fromLibraryResult(runtimeResult)
  }

  const importResult = runtimeResult.value.store.createLinkedFolderRecord({
    folder: validation.value
  })

  if (!importResult.ok) {
    return fromLibraryResult(importResult)
  }

  return await runScan(runtimeResult.value, sender)
}

async function importOneCopiedVideo(
  dependencies: ResolvedLibraryIpcDependencies,
  runtime: LibraryRuntime,
  sourcePath: string,
  reservedTargets: Set<string>
): Promise<LibraryResult<LibraryImportSummary>> {
  const sourceValidation = await validateCopySourceFile(dependencies, sourcePath)

  if (!sourceValidation.ok) {
    return sourceValidation
  }

  const targetResult = await createManagedCopyTarget(
    dependencies,
    runtime.storage,
    sourceValidation.value.sourcePath,
    sourceValidation.value.extension,
    reservedTargets
  )

  if (!targetResult.ok) {
    return targetResult
  }

  const copyResult = await copyFileIntoManagedLibrary(
    dependencies,
    sourceValidation.value.sourcePath,
    targetResult.value
  )

  if (!copyResult.ok) {
    return copyResult
  }

  const persistResult = runtime.store.createCopiedClipRecord({
    sourceFile: sourceValidation.value.sourcePath,
    managedFile: targetResult.value
  })

  if (!persistResult.ok) {
    await removeUntrackedManagedCopy(dependencies, targetResult.value)
    return persistResult
  }

  return libraryOk(persistResult.value.summary)
}

async function copyVideosIntoLibrary(
  dependencies: ResolvedLibraryIpcDependencies,
  ensureRuntime: () => LibraryResult<LibraryRuntime>
): Promise<ClipdockResult<LibraryImportResult>> {
  const dialogResult = await showOpenDialog(
    dependencies,
    {
      title: 'Copy videos into the ClipDock library',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Supported videos', extensions: VIDEO_FILTER_EXTENSIONS }]
    },
    'The ClipDock video import picker could not be opened.'
  )

  if (!dialogResult.ok) {
    return dialogResult
  }

  if (dialogResult.value.canceled || dialogResult.value.filePaths.length === 0) {
    return fail('CANCELLED', 'No videos were selected for import.', { phase: 'dialog' })
  }

  const runtimeResult = ensureRuntime()

  if (!runtimeResult.ok) {
    return fromLibraryResult(runtimeResult)
  }

  const preparedDirectory = await ensureManagedLibraryDirectory(
    dependencies,
    runtimeResult.value.storage
  )

  if (!preparedDirectory.ok) {
    return fromLibraryResult(preparedDirectory)
  }

  const counters: ImportCounters = {
    createdSourceCount: 0,
    createdClipCount: 0,
    duplicateSourceCount: 0,
    duplicateClipCount: 0,
    skippedCount: 0,
    failedCount: 0
  }
  const failures: LibraryFailure[] = []
  const reservedTargets = new Set<string>()

  for (const sourcePath of dialogResult.value.filePaths) {
    const importResult = await importOneCopiedVideo(
      dependencies,
      runtimeResult.value,
      sourcePath,
      reservedTargets
    )

    if (importResult.ok) {
      addSummaryCounts(counters, importResult.value)
      continue
    }

    counters.failedCount += 1
    counters.skippedCount += 1
    appendBoundedFailure(failures, importResult.error)
  }

  return importResultWithSnapshot(runtimeResult.value, makeCopiedBatchSummary(counters, failures))
}

async function getLibrarySnapshot(
  ensureRuntime: () => LibraryResult<LibraryRuntime>
): Promise<ClipdockResult<LibrarySnapshot>> {
  const runtimeResult = ensureRuntime()

  if (!runtimeResult.ok) {
    return fromLibraryResult(runtimeResult)
  }

  return fromLibraryResult(runtimeResult.value.store.snapshot())
}

async function updateSnapshot(
  ensureRuntime: () => LibraryResult<LibraryRuntime>,
  update: (store: LibraryStore) => LibraryResult<LibrarySnapshot>
): Promise<ClipdockResult<LibrarySnapshot>> {
  const runtimeResult = ensureRuntime()

  if (!runtimeResult.ok) {
    return fromLibraryResult(runtimeResult)
  }

  return fromLibraryResult(update(runtimeResult.value.store))
}

function validClipId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function validClipIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        )
      ].slice(0, 256)
    : []
}

function validText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function validRotation(value: unknown): 0 | 90 | 180 | 270 | null {
  return value === 0 || value === 90 || value === 180 || value === 270 ? value : null
}

function validTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((tag): tag is string => typeof tag === 'string').slice(0, 24)
}

async function validateClipFile(
  store: LibraryStore,
  clipId: string
): Promise<ClipdockResult<string>> {
  const asset = store.getClipAsset(clipId, 'media')

  if (!asset.ok) {
    return fromLibraryResult(asset)
  }

  const extension = getSupportedExtension(asset.value)

  if (!extension) {
    return fail('UNSUPPORTED_EXTENSION', 'ClipDock can drag supported video files only.', {
      phase: 'drag',
      sourcePath: asset.value
    })
  }

  try {
    const stats = await stat(asset.value)

    if (!stats.isFile()) {
      return fail('NOT_A_FILE', 'The selected clip path is not a file.', {
        phase: 'drag',
        sourcePath: asset.value
      })
    }
  } catch {
    return fail('MISSING_FILE', 'The selected clip file is no longer available.', {
      phase: 'drag',
      sourcePath: asset.value
    })
  }

  return ok(asset.value)
}

function createDragIcon(): Electron.NativeImage {
  const image = nativeImage.createFromPath(icon)

  return image.isEmpty() ? nativeImage.createEmpty() : image
}

async function startClipDrag(
  event: IpcMainEvent,
  ensureRuntime: () => LibraryResult<LibraryRuntime>,
  request: ClipDragRequest
): Promise<void> {
  const runtimeResult = ensureRuntime()
  const clipIds = Array.isArray(request?.clipIds)
    ? request.clipIds.filter(Boolean).slice(0, 32)
    : []

  if (!runtimeResult.ok) {
    event.sender.send(CLIP_DRAG_EVENT_CHANNEL, {
      type: 'drag-failed',
      clipIds,
      error: runtimeResult.error
    })
    return
  }

  if (clipIds.length === 0) {
    event.sender.send(CLIP_DRAG_EVENT_CHANNEL, {
      type: 'drag-failed',
      clipIds,
      error: { code: 'CLIP_NOT_FOUND', phase: 'drag', message: 'Select a clip before dragging.' }
    })
    return
  }

  const files: string[] = []

  for (const clipId of clipIds) {
    const validation = await validateClipFile(runtimeResult.value.store, clipId)

    if (!validation.ok) {
      event.sender.send(CLIP_DRAG_EVENT_CHANNEL, {
        type: 'drag-failed',
        clipIds,
        error: validation.error
      })
      return
    }

    files.push(validation.value)
  }

  try {
    const dragItem =
      files.length === 1
        ? { file: files[0], icon: createDragIcon() }
        : ({ files, icon: createDragIcon() } as unknown as Parameters<WebContents['startDrag']>[0])

    event.sender.startDrag(dragItem)
    event.sender.send(CLIP_DRAG_EVENT_CHANNEL, { type: 'drag-started', clipIds })
  } catch {
    event.sender.send(CLIP_DRAG_EVENT_CHANNEL, {
      type: 'drag-failed',
      clipIds,
      error: {
        code: 'DRAG_FAILED',
        phase: 'drag',
        message: 'The native file drag could not be started.'
      }
    })
  }
}

export function registerLibraryIpc(
  dependencies: LibraryIpcDependencies = {}
): LibraryIpcRegistration {
  activeLibraryIpc?.dispose()

  const resolvedDependencies = resolveDependencies(dependencies)
  let runtime: LibraryRuntime | null = null
  let disposed = false

  const ensureRuntime = (): LibraryResult<LibraryRuntime> => {
    if (disposed) {
      return libraryFail(
        'LIBRARY_CLOSED',
        'open',
        'The ClipDock library IPC registration has been disposed.'
      )
    }

    if (runtime) {
      return libraryOk(runtime)
    }

    const storageResult = resolveLibraryStorage(resolvedDependencies.app)

    if (!storageResult.ok) {
      return storageResult
    }

    const storeResult = resolvedDependencies.openLibraryStore({
      databaseFile: storageResult.value.databaseFile,
      libraryDir: storageResult.value.managedLibraryDir
    })

    if (!storeResult.ok) {
      return storeResult
    }

    runtime = {
      store: storeResult.value,
      storage: storageResult.value
    }

    return libraryOk(runtime)
  }

  const close = (): ClipdockResult<void> => {
    if (!runtime) {
      return ok(undefined)
    }

    const store = runtime.store
    runtime = null

    return fromLibraryResult(store.close())
  }

  const dispose = (): ClipdockResult<void> => {
    disposed = true
    removeLibraryHandlers(resolvedDependencies.ipcMain)

    const closeResult = close()

    if (activeLibraryIpc === registration) {
      activeLibraryIpc = null
    }

    return closeResult
  }

  const resolveAssetPath = (clipId: string, kind: 'media' | 'thumbnail'): LibraryResult<string> => {
    const runtimeResult = ensureRuntime()

    if (!runtimeResult.ok) {
      return runtimeResult
    }

    return runtimeResult.value.store.getClipAsset(clipId, kind)
  }

  const registration: LibraryIpcRegistration = { close, dispose, resolveAssetPath }

  removeLibraryHandlers(resolvedDependencies.ipcMain)
  resolvedDependencies.ipcMain.handle(GET_LIBRARY_SNAPSHOT_CHANNEL, () =>
    getLibrarySnapshot(ensureRuntime)
  )
  resolvedDependencies.ipcMain.handle(ADD_LINKED_FOLDER_CHANNEL, (event) =>
    addLinkedFolder(resolvedDependencies, ensureRuntime, event.sender)
  )
  resolvedDependencies.ipcMain.handle(COPY_VIDEOS_INTO_LIBRARY_CHANNEL, () =>
    copyVideosIntoLibrary(resolvedDependencies, ensureRuntime)
  )
  resolvedDependencies.ipcMain.handle(RESCAN_LIBRARY_CHANNEL, (event) => {
    const runtimeResult = ensureRuntime()

    return runtimeResult.ok
      ? runScan(runtimeResult.value, event.sender)
      : fromLibraryResult(runtimeResult)
  })
  resolvedDependencies.ipcMain.handle(TOGGLE_FAVORITE_CHANNEL, (_event, clipId: unknown) => {
    const id = validClipId(clipId)

    return id
      ? updateSnapshot(ensureRuntime, (store) => store.toggleFavorite(id))
      : fail('LIBRARY_INVALID_INPUT', 'A valid clip id is required.', { phase: 'update' })
  })
  resolvedDependencies.ipcMain.handle(
    UPDATE_CLIP_TAGS_CHANNEL,
    (_event, clipId: unknown, tags: unknown) => {
      const id = validClipId(clipId)

      return id
        ? updateSnapshot(ensureRuntime, (store) => store.updateClipTags(id, validTags(tags)))
        : fail('LIBRARY_INVALID_INPUT', 'A valid clip id is required.', { phase: 'update' })
    }
  )
  resolvedDependencies.ipcMain.handle(
    UPDATE_CLIP_NOTE_CHANNEL,
    (_event, clipId: unknown, note: unknown) => {
      const id = validClipId(clipId)

      return id
        ? updateSnapshot(ensureRuntime, (store) =>
            store.updateClipNote(id, typeof note === 'string' ? note : '')
          )
        : fail('LIBRARY_INVALID_INPUT', 'A valid clip id is required.', { phase: 'update' })
    }
  )
  resolvedDependencies.ipcMain.handle(CREATE_BIN_CHANNEL, (_event, name: unknown) =>
    updateSnapshot(ensureRuntime, (store) => store.createBin(validText(name)))
  )
  resolvedDependencies.ipcMain.handle(RENAME_BIN_CHANNEL, (_event, binId: unknown, name: unknown) => {
    const id = validClipId(binId)

    return id
      ? updateSnapshot(ensureRuntime, (store) => store.renameBin(id, validText(name)))
      : fail('LIBRARY_INVALID_INPUT', 'A valid bin id is required.', { phase: 'bin' })
  })
  resolvedDependencies.ipcMain.handle(DELETE_BIN_CHANNEL, (_event, binId: unknown) => {
    const id = validClipId(binId)

    return id
      ? updateSnapshot(ensureRuntime, (store) => store.deleteBin(id))
      : fail('LIBRARY_INVALID_INPUT', 'A valid bin id is required.', { phase: 'bin' })
  })
  resolvedDependencies.ipcMain.handle(
    ADD_CLIPS_TO_BIN_CHANNEL,
    (_event, clipIds: unknown, binId: unknown) => {
      const id = validClipId(binId)

      return id
        ? updateSnapshot(ensureRuntime, (store) => store.addClipsToBin(validClipIds(clipIds), id))
        : fail('LIBRARY_INVALID_INPUT', 'A valid bin id is required.', { phase: 'bin' })
    }
  )
  resolvedDependencies.ipcMain.handle(
    MOVE_CLIPS_TO_BIN_CHANNEL,
    (_event, clipIds: unknown, fromBinId: unknown, toBinId: unknown) => {
      const fromId = validClipId(fromBinId)
      const toId = validClipId(toBinId)

      return fromId && toId
        ? updateSnapshot(ensureRuntime, (store) =>
            store.moveClipsToBin(validClipIds(clipIds), fromId, toId)
          )
        : fail('LIBRARY_INVALID_INPUT', 'Valid source and target bin ids are required.', {
            phase: 'bin'
          })
    }
  )
  resolvedDependencies.ipcMain.handle(
    REMOVE_CLIPS_FROM_BIN_CHANNEL,
    (_event, clipIds: unknown, binId: unknown) => {
      const id = validClipId(binId)

      return id
        ? updateSnapshot(ensureRuntime, (store) =>
            store.removeClipsFromBin(validClipIds(clipIds), id)
          )
        : fail('LIBRARY_INVALID_INPUT', 'A valid bin id is required.', { phase: 'bin' })
    }
  )
  resolvedDependencies.ipcMain.handle(REMOVE_CLIPS_FROM_LIBRARY_CHANNEL, (_event, clipIds: unknown) =>
    updateSnapshot(ensureRuntime, (store) => store.removeClipsFromLibrary(validClipIds(clipIds)))
  )
  resolvedDependencies.ipcMain.handle(
    UPDATE_CLIP_ROTATION_CHANNEL,
    (_event, clipId: unknown, rotation: unknown) => {
      const id = validClipId(clipId)
      const degrees = validRotation(rotation)

      return id && degrees !== null
        ? updateSnapshot(ensureRuntime, (store) => store.updateClipRotation(id, degrees))
        : fail('LIBRARY_INVALID_INPUT', 'A valid clip id and rotation are required.', {
            phase: 'update'
          })
    }
  )
  resolvedDependencies.ipcMain.handle(REVEAL_CLIP_CHANNEL, async (_event, clipId: unknown) => {
    const id = validClipId(clipId)

    if (!id) {
      return fail('LIBRARY_INVALID_INPUT', 'A valid clip id is required.', { phase: 'reveal' })
    }

    const runtimeResult = ensureRuntime()

    if (!runtimeResult.ok) {
      return fromLibraryResult(runtimeResult)
    }

    const validation = await validateClipFile(runtimeResult.value.store, id)

    if (!validation.ok) {
      return validation
    }

    shell.showItemInFolder(validation.value)
    return ok(undefined)
  })
  resolvedDependencies.ipcMain.handle(COPY_CLIP_PATH_CHANNEL, (_event, clipId: unknown) => {
    const id = validClipId(clipId)

    if (!id) {
      return fail('LIBRARY_INVALID_INPUT', 'A valid clip id is required.', { phase: 'clipboard' })
    }

    const runtimeResult = ensureRuntime()

    if (!runtimeResult.ok) {
      return fromLibraryResult(runtimeResult)
    }

    const asset = runtimeResult.value.store.getClipAsset(id, 'media')

    if (!asset.ok) {
      return fromLibraryResult(asset)
    }

    clipboard.writeText(asset.value)
    return ok(undefined)
  })
  resolvedDependencies.ipcMain.on(
    START_CLIP_DRAG_CHANNEL,
    (event: IpcMainEvent, request: ClipDragRequest) => {
      void startClipDrag(event, ensureRuntime, request).catch(() => {
        event.sender.send(CLIP_DRAG_EVENT_CHANNEL, {
          type: 'drag-failed',
          clipIds: request?.clipIds ?? [],
          error: {
            code: 'DRAG_FAILED',
            phase: 'drag',
            message: 'The native file drag could not be started.'
          }
        })
      })
    }
  )

  activeLibraryIpc = registration

  return registration
}
