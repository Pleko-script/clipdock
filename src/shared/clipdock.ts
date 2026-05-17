export const SUPPORTED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.mov',
  '.mxf',
  '.mkv',
  '.avi',
  '.webm',
  '.m4v',
  '.mpg',
  '.mpeg',
  '.ts',
  '.mts',
  '.m2ts'
] as const

export type SupportedVideoExtension = (typeof SUPPORTED_VIDEO_EXTENSIONS)[number]

export type ClipdockErrorCode =
  | 'CANCELLED'
  | 'DIALOG_FAILED'
  | 'PRELOAD_IPC_FAILED'
  | 'MISSING_FILE'
  | 'NOT_A_FILE'
  | 'UNSUPPORTED_EXTENSION'
  | 'STAT_FAILED'
  | 'DRAG_FAILED'
  | 'ASSET_NOT_FOUND'
  | 'LIBRARY_OPEN_FAILED'
  | 'LIBRARY_MIGRATION_FAILED'
  | 'LIBRARY_CLOSED'
  | 'LIBRARY_INVALID_INPUT'
  | 'LIBRARY_INVALID_LOCATION'
  | 'LIBRARY_UNSUPPORTED_EXTENSION'
  | 'LIBRARY_MISSING_FILE'
  | 'LIBRARY_NOT_A_DIRECTORY'
  | 'LIBRARY_NOT_A_FILE'
  | 'LIBRARY_STAT_FAILED'
  | 'LIBRARY_OUTSIDE_MANAGED_STORAGE'
  | 'LIBRARY_DUPLICATE_SOURCE'
  | 'LIBRARY_DUPLICATE_CLIP'
  | 'LIBRARY_COPY_FAILED'
  | 'LIBRARY_TARGET_COLLISION'
  | 'LIBRARY_PERSIST_FAILED'
  | 'LIBRARY_SNAPSHOT_FAILED'
  | 'LIBRARY_CLOSE_FAILED'
  | 'SCAN_ALREADY_RUNNING'
  | 'SCAN_FAILED'
  | 'SCAN_NO_SOURCES'
  | 'PROBE_FAILED'
  | 'THUMBNAIL_FAILED'
  | 'CLIP_NOT_FOUND'
  | 'CLIP_UPDATE_FAILED'
  | 'BIN_NOT_FOUND'
  | 'BIN_DUPLICATE_NAME'
  | 'BIN_UPDATE_FAILED'
  | 'CLIP_REMOVE_FAILED'
  | 'CLIP_EXPORT_FAILED'

export type LibraryImportPhase =
  | 'open'
  | 'migrate'
  | 'dialog'
  | 'validate-source'
  | 'validate-target'
  | 'stat-source'
  | 'stat-target'
  | 'copy'
  | 'persist'
  | 'snapshot'
  | 'close'
  | 'scan'
  | 'probe'
  | 'thumbnail'
  | 'drag'
  | 'asset'
  | 'clipboard'
  | 'reveal'
  | 'update'
  | 'bin'
  | 'remove'
  | 'export'

export interface ClipdockError {
  code: ClipdockErrorCode
  message: string
  phase?: LibraryImportPhase
  sourcePath?: string
  targetPath?: string
}

export type ClipdockResult<T> = { ok: true; value: T } | { ok: false; error: ClipdockError }

export type ClipImportMode = 'linked-folder' | 'copied-file'

export type LibrarySourceKind = 'folder' | 'managed-file'

export type LibrarySourceStatus = 'active' | 'missing' | 'error' | 'removed'

export type LibraryClipStatus = 'ready' | 'missing' | 'error' | 'removed'

export type ClipRotationDegrees = 0 | 90 | 180 | 270

export interface LibraryFailure extends ClipdockError {
  phase: LibraryImportPhase
}

export type LibraryResult<T> = { ok: true; value: T } | { ok: false; error: LibraryFailure }

export interface LibrarySourceRecordSummary {
  id: string
  kind: LibrarySourceKind
  importMode: ClipImportMode
  status: LibrarySourceStatus
  displayName: string
  displayLocation: string
  clipCount: number
  createdAtMs: number
  updatedAtMs: number
  lastScannedAtMs: number | null
  lastScanStartedAtMs: number | null
  lastScanCompletedAtMs: number | null
  lastErrorCode: ClipdockErrorCode | null
  lastErrorMessage: string | null
}

export interface LibraryBinRecordSummary {
  id: string
  name: string
  sortOrder: number
  clipCount: number
  createdAtMs: number
  updatedAtMs: number
}

export interface LibraryClipExportRecordSummary {
  id: string
  clipId: string
  variantKind: 'rotation'
  rotationDegrees: Exclude<ClipRotationDegrees, 0>
  sourceSizeBytes: number
  sourceModifiedAtMs: number
  exportPath: string
  createdAtMs: number
  updatedAtMs: number
}

export interface LibraryClipRecordSummary {
  id: string
  sourceId: string
  importMode: ClipImportMode
  status: LibraryClipStatus
  displayName: string
  extension: SupportedVideoExtension
  filePath: string
  folderPath: string
  sizeBytes: number
  modifiedAtMs: number
  fileCreatedAtMs: number | null
  durationMs: number | null
  widthPixels: number | null
  heightPixels: number | null
  fps: number | null
  codec: string | null
  metadataJson: string | null
  thumbnailUrl: string | null
  previewUrl: string
  favorite: boolean
  note: string
  tags: string[]
  binIds: string[]
  rotationDegrees: ClipRotationDegrees
  createdAtMs: number
  updatedAtMs: number
  lastErrorCode: ClipdockErrorCode | null
  lastErrorMessage: string | null
}

export interface LibrarySnapshot {
  generatedAtMs: number
  sources: LibrarySourceRecordSummary[]
  bins: LibraryBinRecordSummary[]
  clips: LibraryClipRecordSummary[]
}

export interface LibraryImportSummary {
  mode: ClipImportMode
  status: 'imported' | 'duplicate' | 'partial' | 'failed'
  createdSourceCount: number
  createdClipCount: number
  duplicateSourceCount: number
  duplicateClipCount: number
  skippedCount: number
  failedCount: number
  errors: LibraryFailure[]
}

export interface LinkedFolderImportResult {
  source: LibrarySourceRecordSummary
  summary: LibraryImportSummary
}

export interface CopiedClipImportResult {
  source: LibrarySourceRecordSummary
  clip: LibraryClipRecordSummary
  summary: LibraryImportSummary
}

export interface LibraryImportResult {
  snapshot: LibrarySnapshot
  summary: LibraryImportSummary
}

export interface ScanSummary {
  sourceCount: number
  totalFiles: number
  scannedFiles: number
  importedClips: number
  updatedClips: number
  skippedClips: number
  failedClips: number
  startedAtMs: number
  completedAtMs: number
}

export interface ScanResult {
  snapshot: LibrarySnapshot
  summary: ScanSummary
}

export type ScanEvent =
  | {
      type: 'scan-started'
      sourceCount: number
      totalFiles: number
      startedAtMs: number
    }
  | {
      type: 'scan-progress'
      sourceId: string
      currentFile: string
      scannedFiles: number
      totalFiles: number
    }
  | {
      type: 'scan-file-error'
      sourceId: string
      currentFile: string
      error: ClipdockError
      scannedFiles: number
      totalFiles: number
    }
  | {
      type: 'scan-completed'
      summary: ScanSummary
    }
  | {
      type: 'scan-failed'
      error: ClipdockError
    }

export interface ClipDragRequest {
  clipIds: string[]
}

export interface ClipDragEvent {
  type: 'drag-started' | 'drag-failed'
  clipIds: string[]
  error?: ClipdockError
}

export interface ClipdockApi {
  getLibrarySnapshot: () => Promise<ClipdockResult<LibrarySnapshot>>
  addLinkedFolder: () => Promise<ClipdockResult<ScanResult>>
  copyVideosIntoLibrary: () => Promise<ClipdockResult<LibraryImportResult>>
  rescanLibrary: () => Promise<ClipdockResult<ScanResult>>
  toggleFavorite: (clipId: string) => Promise<ClipdockResult<LibrarySnapshot>>
  updateClipTags: (clipId: string, tags: string[]) => Promise<ClipdockResult<LibrarySnapshot>>
  updateClipNote: (clipId: string, note: string) => Promise<ClipdockResult<LibrarySnapshot>>
  createBin: (name: string) => Promise<ClipdockResult<LibrarySnapshot>>
  renameBin: (binId: string, name: string) => Promise<ClipdockResult<LibrarySnapshot>>
  deleteBin: (binId: string) => Promise<ClipdockResult<LibrarySnapshot>>
  addClipsToBin: (clipIds: string[], binId: string) => Promise<ClipdockResult<LibrarySnapshot>>
  moveClipsToBin: (
    clipIds: string[],
    fromBinId: string,
    toBinId: string
  ) => Promise<ClipdockResult<LibrarySnapshot>>
  removeClipsFromBin: (
    clipIds: string[],
    binId: string
  ) => Promise<ClipdockResult<LibrarySnapshot>>
  removeClipsFromLibrary: (clipIds: string[]) => Promise<ClipdockResult<LibrarySnapshot>>
  updateClipRotation: (
    clipId: string,
    rotationDegrees: ClipRotationDegrees
  ) => Promise<ClipdockResult<LibrarySnapshot>>
  revealClip: (clipId: string) => Promise<ClipdockResult<void>>
  copyClipPath: (clipId: string) => Promise<ClipdockResult<void>>
  startClipDrag: (request: ClipDragRequest) => void
  onScanEvent: (listener: (event: ScanEvent) => void) => () => void
  onClipDragEvent: (listener: (event: ClipDragEvent) => void) => () => void
}
