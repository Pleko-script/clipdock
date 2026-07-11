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

export type ClipdockErrorCode = 'PRELOAD_IPC_FAILED' | 'DRAG_FAILED' | 'LIBRARY_PERSIST_FAILED'

export type ClipdockPhase = 'open' | 'migrate' | 'asset' | 'scan' | 'update' | 'drag'

export interface ClipdockError {
  code: ClipdockErrorCode
  message: string
  phase?: ClipdockPhase
}

export type ClipdockResult<T> = { ok: true; value: T } | { ok: false; error: ClipdockError }

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
  startAssetDrag: (request: AssetDragRequest) => void
  onAssetJobEvent: (listener: (event: AssetJobEvent) => void) => () => void
  onAssetDragEvent: (listener: (event: AssetDragEvent) => void) => () => void
}
