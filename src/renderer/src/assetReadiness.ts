import type { AssetSummary } from '../../shared/clipdock'

export type AssetDragReadiness =
  | 'original-ready'
  | 'derivative-ready'
  | 'derivative-preparing'
  | 'failed'
  | 'missing'
  | 'unsupported'

export function hasAssetEdit(asset: AssetSummary): boolean {
  return asset.trimStartMs !== null || asset.rotationDegrees !== 0
}

export function assetDragReadiness(asset: AssetSummary): AssetDragReadiness {
  if (asset.status === 'missing') return 'missing'
  if (asset.status === 'error') return 'failed'
  if (asset.compatibility === 'unsupported') return 'unsupported'
  if (!hasAssetEdit(asset)) return 'original-ready'
  if (asset.trimStatus === 'ready') return 'derivative-ready'
  if (asset.trimStatus === 'failed') return 'failed'
  return 'derivative-preparing'
}

export function assetCanDrag(asset: AssetSummary): boolean {
  const readiness = assetDragReadiness(asset)
  return readiness === 'original-ready' || readiness === 'derivative-ready'
}

export function assetIsPortrait(asset: AssetSummary): boolean {
  return Boolean(asset.widthPixels && asset.heightPixels && asset.heightPixels > asset.widthPixels)
}

export function assetHasAudio(asset: AssetSummary): boolean {
  return asset.mediaType === 'audio' || Boolean(asset.audioCodec || asset.channels)
}
