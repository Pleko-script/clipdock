import { extname } from 'node:path'
import {
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  type AssetKind,
  type AssetMediaType
} from '../shared/clipdock'

const VIDEO_EXTENSIONS = new Set<string>(SUPPORTED_VIDEO_EXTENSIONS)
const AUDIO_EXTENSIONS = new Set<string>(SUPPORTED_AUDIO_EXTENSIONS)
const TRANSITION_TERMS = new Set(['transition', 'transitions', 'trans', 'wipe', 'intro'])
const OVERLAY_TERMS = new Set([
  'overlay',
  'overlays',
  'leak',
  'grain',
  'particle',
  'particles',
  'dust'
])

export function assetMediaType(filePath: string): AssetMediaType | null {
  const extension = extname(filePath).toLocaleLowerCase('en-US')
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  return null
}

export function inferAssetKind(relativePath: string, mediaType: AssetMediaType): AssetKind {
  if (mediaType === 'audio') return 'sound'
  const terms = relativePath.toLocaleLowerCase('en-US').split(/[\\/_\-.\s]+/)
  if (terms.some((term) => TRANSITION_TERMS.has(term))) return 'transition'
  if (terms.some((term) => OVERLAY_TERMS.has(term))) return 'overlay'
  return 'unknown'
}
