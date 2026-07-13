import type { DragEvent, JSX } from 'react'
import {
  AlertTriangle,
  FolderHeart,
  FolderOpen,
  Heart,
  History,
  Library,
  Link2,
  ListFilter,
  Pencil,
  Plus,
  Save,
  Trash2
} from 'lucide-react'
import type { AssetNavigationSnapshot, AssetSmartCollectionSummary } from '../../../shared/clipdock'
import { useI18n } from '../i18n'

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
  activeSmartCollectionId,
  selectedTag,
  favoriteOnly,
  recentlyUsed,
  busy,
  onShowAll,
  onShowFavorites,
  onShowRecentlyUsed,
  onSelectPack,
  onSelectCollection,
  onSelectSmartCollection,
  onSelectTag,
  onAddPack,
  onRelinkPack,
  onCreateCollection,
  onCreateSmartCollection,
  onRenameCollection,
  onDeleteCollection,
  onRenameSmartCollection,
  onUpdateSmartCollection,
  onDeleteSmartCollection,
  onDropCollection
}: {
  navigation: AssetNavigationSnapshot
  activePackId: string | null
  activeCollectionId: string | null
  activeSmartCollectionId: string | null
  selectedTag: string | null
  favoriteOnly: boolean
  recentlyUsed: boolean
  busy: boolean
  onShowAll: () => void
  onShowFavorites: () => void
  onShowRecentlyUsed: () => void
  onSelectPack: (id: string) => void
  onSelectCollection: (id: string) => void
  onSelectSmartCollection: (collection: AssetSmartCollectionSummary) => void
  onSelectTag: (tag: string) => void
  onAddPack: () => void
  onRelinkPack: (id: string) => void
  onCreateCollection: () => void
  onCreateSmartCollection: () => void
  onRenameCollection: (id: string, currentName: string) => void
  onDeleteCollection: (id: string, currentName: string) => void
  onRenameSmartCollection: (collection: AssetSmartCollectionSummary) => void
  onUpdateSmartCollection: (collection: AssetSmartCollectionSummary) => void
  onDeleteSmartCollection: (collection: AssetSmartCollectionSummary) => void
  onDropCollection: (assetIds: string[], collectionId: string) => void
}): JSX.Element {
  const { language, setLanguage, t } = useI18n()
  return (
    <aside className="asset-sidebar">
      <div className="asset-brand">
        <span className="asset-brand-mark">CD</span>
        <strong>ClipDock</strong>
      </div>

      <button type="button" className="add-pack-button" onClick={onAddPack} disabled={busy}>
        <Plus size={17} />
        {t('sidebar.addPack')}
      </button>

      <nav className="sidebar-nav" aria-label={t('sidebar.library')}>
        <button
          type="button"
          className={
            !activePackId &&
            !activeCollectionId &&
            !activeSmartCollectionId &&
            !selectedTag &&
            !favoriteOnly &&
            !recentlyUsed
              ? 'active'
              : ''
          }
          onClick={onShowAll}
        >
          <Library size={17} />
          <span>{t('sidebar.allAssets')}</span>
          <em>{navigation.totalAssets}</em>
        </button>
        <button
          type="button"
          className={favoriteOnly && !activeSmartCollectionId ? 'active' : ''}
          onClick={onShowFavorites}
        >
          <Heart size={17} />
          <span>{t('sidebar.favorites')}</span>
          <em>{navigation.favoriteCount}</em>
        </button>
        <button
          type="button"
          className={recentlyUsed && !activeSmartCollectionId ? 'active' : ''}
          onClick={onShowRecentlyUsed}
        >
          <History size={17} />
          <span>{t('sidebar.recentlyUsed')}</span>
          <em>{navigation.usedAssetCount}</em>
        </button>
      </nav>

      <section className="sidebar-group">
        <header>
          <span>{t('sidebar.packs')}</span>
        </header>
        {navigation.packs.length === 0 ? <p>{t('sidebar.noPacks')}</p> : null}
        {navigation.packs.map((pack) => (
          <div
            className={`sidebar-item-row${pack.missingCount || pack.rootMissing ? ' missing' : ''}`}
            key={pack.id}
          >
            <button
              type="button"
              className={activePackId === pack.id && !activeSmartCollectionId ? 'active' : ''}
              onClick={() => onSelectPack(pack.id)}
              title={pack.rootPath}
            >
              <FolderOpen size={16} />
              <span>{pack.name}</span>
              <em className="pack-summary-count">
                {pack.assetCount}
                {pack.missingCount ? (
                  <span title={t('sidebar.missingAssets', { count: pack.missingCount })}>
                    <AlertTriangle size={10} />
                    {pack.missingCount}
                  </span>
                ) : null}
                {pack.rootMissing ? (
                  <span title={t('sidebar.packMissing')}>
                    <AlertTriangle size={10} />!
                  </span>
                ) : null}
              </em>
            </button>
            <button
              type="button"
              className="sidebar-item-action"
              onClick={() => onRelinkPack(pack.id)}
              title={t('sidebar.relinkPack')}
              aria-label={t('sidebar.relinkNamed', { name: pack.name })}
            >
              <Link2 size={14} />
            </button>
          </div>
        ))}
      </section>

      <section className="sidebar-group">
        <header>
          <span>{t('sidebar.collections')}</span>
          <button
            type="button"
            onClick={onCreateCollection}
            aria-label={t('sidebar.createCollection')}
          >
            <Plus size={15} />
          </button>
        </header>
        {navigation.collections.length === 0 ? <p>{t('sidebar.noCollections')}</p> : null}
        {navigation.collections.map((collection) => (
          <div
            className="sidebar-item-row collection-row"
            key={collection.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDropCollection(parseDraggedAssets(event), collection.id)}
          >
            <button
              type="button"
              className={
                activeCollectionId === collection.id && !activeSmartCollectionId ? 'active' : ''
              }
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
                title={t('sidebar.renameCollection')}
                aria-label={t('sidebar.renameNamed', { name: collection.name })}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => onDeleteCollection(collection.id, collection.name)}
                title={t('sidebar.deleteCollection')}
                aria-label={t('sidebar.deleteNamed', { name: collection.name })}
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
      </section>

      <section className="sidebar-group">
        <header>
          <span>{t('sidebar.smartCollections')}</span>
          <button
            type="button"
            onClick={onCreateSmartCollection}
            aria-label={t('sidebar.createSmartCollection')}
          >
            <Plus size={15} />
          </button>
        </header>
        {navigation.smartCollections.length === 0 ? <p>{t('sidebar.noSmartCollections')}</p> : null}
        {navigation.smartCollections.map((collection) => (
          <div className="sidebar-item-row" key={collection.id}>
            <button
              type="button"
              className={activeSmartCollectionId === collection.id ? 'active' : ''}
              onClick={() => onSelectSmartCollection(collection)}
              title={
                collection.criteriaValid ? collection.name : t('sidebar.invalidSmartCollection')
              }
            >
              <ListFilter size={16} />
              <span>{collection.name}</span>
            </button>
            <span className="sidebar-item-actions">
              <button
                type="button"
                onClick={() => onUpdateSmartCollection(collection)}
                title={t('sidebar.updateSmartCollection')}
                aria-label={t('sidebar.updateSmartNamed', { name: collection.name })}
              >
                <Save size={13} />
              </button>
              <button
                type="button"
                onClick={() => onRenameSmartCollection(collection)}
                title={t('sidebar.renameSmartCollection')}
                aria-label={t('sidebar.renameNamed', { name: collection.name })}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => onDeleteSmartCollection(collection)}
                title={t('sidebar.deleteSmartCollection')}
                aria-label={t('sidebar.deleteNamed', { name: collection.name })}
              >
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        ))}
      </section>

      <section className="sidebar-group sidebar-tags">
        <header>
          <span>{t('sidebar.tags')}</span>
        </header>
        <div>
          {navigation.tags.map((tag) => (
            <button
              type="button"
              key={tag}
              className={selectedTag === tag && !activeSmartCollectionId ? 'active' : ''}
              onClick={() => onSelectTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      <div className="sidebar-language" aria-label={t('sidebar.language')}>
        <span>{t('sidebar.language')}</span>
        <div>
          <button
            type="button"
            className={language === 'de' ? 'active' : ''}
            onClick={() => setLanguage('de')}
            aria-pressed={language === 'de'}
          >
            DE
          </button>
          <button
            type="button"
            className={language === 'en' ? 'active' : ''}
            onClick={() => setLanguage('en')}
            aria-pressed={language === 'en'}
          >
            EN
          </button>
        </div>
      </div>
    </aside>
  )
}
