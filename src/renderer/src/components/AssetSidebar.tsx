import type { DragEvent, JSX } from 'react'
import {
  Boxes,
  FolderHeart,
  FolderOpen,
  Heart,
  Library,
  Link2,
  Pencil,
  Plus,
  Tags,
  Trash2
} from 'lucide-react'
import type { AssetNavigationSnapshot } from '../../../shared/clipdock'

function parseDraggedAssets(event: DragEvent): string[] {
  try {
    const value = JSON.parse(event.dataTransfer.getData('application/x-clipdock-asset-ids'))
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function AssetSidebar({
  navigation,
  activePackId,
  activeCollectionId,
  selectedTag,
  favoriteOnly,
  busy,
  onShowAll,
  onShowFavorites,
  onSelectPack,
  onSelectCollection,
  onSelectTag,
  onAddPack,
  onRelinkPack,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onDropCollection
}: {
  navigation: AssetNavigationSnapshot
  activePackId: string | null
  activeCollectionId: string | null
  selectedTag: string | null
  favoriteOnly: boolean
  busy: boolean
  onShowAll: () => void
  onShowFavorites: () => void
  onSelectPack: (id: string) => void
  onSelectCollection: (id: string) => void
  onSelectTag: (tag: string) => void
  onAddPack: () => void
  onRelinkPack: (id: string) => void
  onCreateCollection: () => void
  onRenameCollection: (id: string, currentName: string) => void
  onDeleteCollection: (id: string, currentName: string) => void
  onDropCollection: (assetIds: string[], collectionId: string) => void
}): JSX.Element {
  return (
    <aside className="asset-sidebar">
      <div className="asset-brand">
        <span className="asset-brand-mark">CD</span>
        <div>
          <strong>ClipDock</strong>
          <span>Motion asset library</span>
        </div>
      </div>

      <button type="button" className="add-pack-button" onClick={onAddPack} disabled={busy}>
        <Plus size={17} />
        Add Pack
      </button>

      <nav className="sidebar-nav" aria-label="Asset library">
        <button
          type="button"
          className={
            !activePackId && !activeCollectionId && !selectedTag && !favoriteOnly ? 'active' : ''
          }
          onClick={onShowAll}
        >
          <Library size={17} />
          <span>All assets</span>
          <em>{navigation.totalAssets}</em>
        </button>
        <button type="button" className={favoriteOnly ? 'active' : ''} onClick={onShowFavorites}>
          <Heart size={17} />
          <span>Favorites</span>
          <em>{navigation.favoriteCount}</em>
        </button>
      </nav>

      <section className="sidebar-group">
        <header>
          <span>
            <Boxes size={15} />
            Packs
          </span>
        </header>
        {navigation.packs.length === 0 ? <p>No packs yet</p> : null}
        {navigation.packs.map((pack) => (
          <div className="sidebar-item-row" key={pack.id}>
            <button
              type="button"
              className={activePackId === pack.id ? 'active' : ''}
              onClick={() => onSelectPack(pack.id)}
              title={pack.rootPath}
            >
              <FolderOpen size={16} />
              <span>{pack.name}</span>
              <em>{pack.assetCount}</em>
            </button>
            <button
              type="button"
              className="sidebar-item-action"
              onClick={() => onRelinkPack(pack.id)}
              title="Relink pack"
            >
              <Link2 size={14} />
            </button>
          </div>
        ))}
      </section>

      <section className="sidebar-group">
        <header>
          <span>
            <FolderHeart size={15} />
            Collections
          </span>
          <button type="button" onClick={onCreateCollection} aria-label="Create collection">
            <Plus size={15} />
          </button>
        </header>
        {navigation.collections.length === 0 ? <p>No collections</p> : null}
        {navigation.collections.map((collection) => (
          <div
            className="sidebar-item-row collection-row"
            key={collection.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDropCollection(parseDraggedAssets(event), collection.id)}
          >
            <button
              type="button"
              className={activeCollectionId === collection.id ? 'active' : ''}
              onClick={() => onSelectCollection(collection.id)}
            >
              <FolderHeart size={16} />
              <span>{collection.name}</span>
              <em>{collection.assetCount}</em>
            </button>
            <span className="sidebar-item-actions">
              <button
                type="button"
                onClick={() => onRenameCollection(collection.id, collection.name)}
                title="Rename collection"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => onDeleteCollection(collection.id, collection.name)}
                title="Delete collection"
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
      </section>

      <section className="sidebar-group sidebar-tags">
        <header>
          <span>
            <Tags size={15} />
            Tags
          </span>
        </header>
        <div>
          {navigation.tags.map((tag) => (
            <button
              type="button"
              key={tag}
              className={selectedTag === tag ? 'active' : ''}
              onClick={() => onSelectTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>
    </aside>
  )
}
