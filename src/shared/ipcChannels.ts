export const assetIpcChannels = {
  navigation: 'clipdock:assets:get-navigation',
  query: 'clipdock:assets:query',
  addPack: 'clipdock:assets:add-pack',
  relinkPack: 'clipdock:assets:relink-pack',
  rescanPacks: 'clipdock:assets:rescan-packs',
  updateAssets: 'clipdock:assets:update',
  toggleFavorite: 'clipdock:assets:toggle-favorite',
  createCollection: 'clipdock:assets:create-collection',
  renameCollection: 'clipdock:assets:rename-collection',
  deleteCollection: 'clipdock:assets:delete-collection',
  addToCollection: 'clipdock:assets:add-to-collection',
  reveal: 'clipdock:assets:reveal',
  regeneratePreviews: 'clipdock:assets:regenerate-previews',
  startDrag: 'clipdock:assets:start-drag',
  jobEvent: 'clipdock:assets:job-event',
  dragEvent: 'clipdock:assets:drag-event'
} as const

export const assetInvokeChannels = [
  assetIpcChannels.navigation,
  assetIpcChannels.query,
  assetIpcChannels.addPack,
  assetIpcChannels.relinkPack,
  assetIpcChannels.rescanPacks,
  assetIpcChannels.updateAssets,
  assetIpcChannels.toggleFavorite,
  assetIpcChannels.createCollection,
  assetIpcChannels.renameCollection,
  assetIpcChannels.deleteCollection,
  assetIpcChannels.addToCollection,
  assetIpcChannels.reveal,
  assetIpcChannels.regeneratePreviews
] as const
