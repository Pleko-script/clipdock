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

export const SUPPORTED_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.aac', '.m4a', '.flac', '.ogg'] as const

export type SupportedVideoExtension = (typeof SUPPORTED_VIDEO_EXTENSIONS)[number]
export type SupportedAudioExtension = (typeof SUPPORTED_AUDIO_EXTENSIONS)[number]

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

export type AssetKind = 'transition' | 'overlay' | 'sound' | 'unknown'
export type AssetMediaType = 'video' | 'audio'
export type OverlayMode = 'alpha' | 'screen' | 'raw'
export type CompatibilityLevel = 'verified' | 'expected' | 'unsupported'
export type AssetSortMode = 'name' | 'modified' | 'duration' | 'recent'
export type AssetStatus = 'ready' | 'missing' | 'error'
export type PreviewStatus = 'pending' | 'ready' | 'failed'

export interface AssetPackSummary {
  id: string
  name: string
  rootPath: string
  assetCount: number
  missingCount: number
  createdAtMs: number
  updatedAtMs: number
  lastScannedAtMs: number | null
}

export interface AssetCollectionSummary {
  id: string
  name: string
  assetCount: number
  createdAtMs: number
  updatedAtMs: number
}

export interface AssetSummary {
  id: string
  packId: string
  packName: string
  relativePath: string
  categoryPath: string
  displayName: string
  filePath: string
  extension: string
  kind: AssetKind
  mediaType: AssetMediaType
  overlayMode: OverlayMode
  compatibility: CompatibilityLevel
  sizeBytes: number
  modifiedAtMs: number
  durationMs: number | null
  widthPixels: number | null
  heightPixels: number | null
  fps: number | null
  codec: string | null
  audioCodec: string | null
  sampleRate: number | null
  channels: number | null
  hasAlpha: boolean
  favorite: boolean
  note: string
  tags: string[]
  collectionIds: string[]
  status: AssetStatus
  previewStatus: PreviewStatus
  thumbnailUrl: string | null
  previewUrl: string | null
  mediaUrl: string
  lastErrorMessage: string | null
}

export interface AssetQuery {
  cursor?: string
  limit?: number
  search?: string
  kinds?: AssetKind[]
  packIds?: string[]
  collectionIds?: string[]
  tags?: string[]
  favoriteOnly?: boolean
  formats?: string[]
  sort?: AssetSortMode
}

export interface AssetPage {
  items: AssetSummary[]
  nextCursor: string | null
  totalCount: number
}

export interface AssetNavigationSnapshot {
  packs: AssetPackSummary[]
  collections: AssetCollectionSummary[]
  tags: string[]
  totalAssets: number
  favoriteCount: number
  pendingPreviewCount: number
}

export interface AssetUpdateRequest {
  assetIds: string[]
  kind?: AssetKind
  overlayMode?: OverlayMode
  tags?: string[]
  note?: string
}

export interface AssetScanResult {
  packId: string
  scannedFiles: number
  importedAssets: number
  updatedAssets: number
  missingAssets: number
  failedAssets: number
}

export type AssetJobEvent =
  | { type: 'scan-progress'; packId: string; currentFile: string; completed: number; total: number }
  | { type: 'scan-completed'; result: AssetScanResult }
  | { type: 'preview-progress'; assetId: string; completed: number; total: number }
  | { type: 'preview-completed'; assetId: string }
  | { type: 'preview-failed'; assetId: string; message: string }

export interface AssetDragRequest {
  assetIds: string[]
}

export interface AssetDragEvent {
  type: 'drag-started' | 'drag-failed'
  assetIds: string[]
  error?: ClipdockError
}

export interface ClipdockApi {
  getNavigationSnapshot: () => Promise<ClipdockResult<AssetNavigationSnapshot>>
  queryAssets: (query: AssetQuery) => Promise<ClipdockResult<AssetPage>>
  addPackFolder: () => Promise<ClipdockResult<AssetScanResult>>
  relinkPack: (packId: string) => Promise<ClipdockResult<AssetScanResult>>
  rescanPacks: (packIds?: string[]) => Promise<ClipdockResult<AssetScanResult[]>>
  updateAssets: (request: AssetUpdateRequest) => Promise<ClipdockResult<void>>
  toggleAssetFavorite: (assetId: string) => Promise<ClipdockResult<void>>
  createCollection: (name: string) => Promise<ClipdockResult<void>>
  renameCollection: (collectionId: string, name: string) => Promise<ClipdockResult<void>>
  deleteCollection: (collectionId: string) => Promise<ClipdockResult<void>>
  addAssetsToCollection: (assetIds: string[], collectionId: string) => Promise<ClipdockResult<void>>
  revealAsset: (assetId: string) => Promise<ClipdockResult<void>>
  regeneratePreviews: (assetIds: string[]) => Promise<ClipdockResult<void>>
  prepareAssetDrag: (request: AssetDragRequest) => Promise<ClipdockResult<void>>
  startAssetDrag: (request: AssetDragRequest) => void
  onAssetJobEvent: (listener: (event: AssetJobEvent) => void) => () => void
  onAssetDragEvent: (listener: (event: AssetDragEvent) => void) => () => void
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
  removeClipsFromBin: (clipIds: string[], binId: string) => Promise<ClipdockResult<LibrarySnapshot>>
  removeClipsFromLibrary: (clipIds: string[]) => Promise<ClipdockResult<LibrarySnapshot>>
  updateClipRotation: (
    clipId: string,
    rotationDegrees: ClipRotationDegrees
  ) => Promise<ClipdockResult<LibrarySnapshot>>
  revealClip: (clipId: string) => Promise<ClipdockResult<void>>
  copyClipPath: (clipId: string) => Promise<ClipdockResult<void>>
  prepareClipDrag: (request: ClipDragRequest) => Promise<ClipdockResult<void>>
  startClipDrag: (request: ClipDragRequest) => void
  onScanEvent: (listener: (event: ScanEvent) => void) => () => void
  onClipDragEvent: (listener: (event: ClipDragEvent) => void) => () => void
}
