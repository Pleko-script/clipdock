/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const projectRoot = process.cwd()
const read = (path) => readFileSync(join(projectRoot, path), 'utf8')
const packageJson = JSON.parse(read('package.json'))
const shared = read('src/shared/clipdock.ts')
const main = read('src/main/index.ts')
const assetStore = read('src/main/assetStore.ts')
const assetIpc = read('src/main/assetIpc.ts')
const assetScanner = read('src/main/assetScanner.ts')
const assetPreview = read('src/main/assetPreview.ts')
const preload = read('src/preload/index.ts')
const app = read('src/renderer/src/App.tsx')
const grid = read('src/renderer/src/components/AssetGrid.tsx')
const sidebar = read('src/renderer/src/components/AssetSidebar.tsx')
const inspector = read('src/renderer/src/components/AssetInspector.tsx')
const quickLook = read('src/renderer/src/components/QuickLook.tsx')
const html = read('src/renderer/index.html')
const builder = read('electron-builder.yml')
const design = read('DESIGN.md')
const readme = read('README.md')

test('package exposes the app lifecycle, bundled media tools, virtualization, and local fonts', () => {
  assert.equal(packageJson.scripts.dev, 'electron-vite dev')
  assert.equal(packageJson.scripts.build, 'npm run typecheck && electron-vite build')
  for (const dependency of [
    'ffmpeg-static',
    'ffprobe-static',
    '@tanstack/react-virtual',
    '@fontsource/ibm-plex-sans',
    '@fontsource/ibm-plex-mono'
  ]) {
    assert.ok(packageJson.dependencies[dependency])
  }
  assert.doesNotMatch(JSON.stringify(packageJson), /electron-updater|telemetry|sentry/i)
})

test('Electron window stays hardened and local media uses a constrained protocol', () => {
  assert.match(main, /contextIsolation:\s*true/)
  assert.match(main, /nodeIntegration:\s*false/)
  assert.match(main, /sandbox:\s*true/)
  assert.match(main, /webSecurity:\s*true/)
  assert.match(main, /protocol\.handle\('clipdock-media'/)
  assert.match(html, /img-src[^;]*clipdock-media:/)
  assert.match(html, /media-src[^;]*clipdock-media:/)
})

test('public contract is asset-first and covers video, audio, pagination, jobs, and recovery', () => {
  for (const extension of [
    '.mp4',
    '.mov',
    '.m4v',
    '.mkv',
    '.avi',
    '.webm',
    '.mpg',
    '.mpeg',
    '.ts',
    '.mts',
    '.m2ts',
    '.wav',
    '.mp3',
    '.aac',
    '.m4a',
    '.flac',
    '.ogg'
  ]) {
    assert.match(shared, new RegExp(extension.replace('.', '\\.')))
  }
  for (const surface of [
    'AssetKind',
    'AssetMediaType',
    'OverlayMode',
    'CompatibilityLevel',
    'AssetSummary',
    'AssetQuery',
    'AssetPage',
    'getNavigationSnapshot',
    'queryAssets',
    'addPackFolder',
    'relinkPack',
    'rescanPacks',
    'updateAssets',
    'toggleAssetFavorite',
    'createCollection',
    'regeneratePreviews',
    'prepareAssetDrag',
    'startAssetDrag',
    'onAssetJobEvent'
  ])
    assert.match(shared, new RegExp(`\\b${surface}\\b`))
})

test('SQLite asset store contains migration, FTS, pagination, collections, and persistent preview jobs', () => {
  for (const table of [
    'asset_packs',
    'assets',
    'asset_tags',
    'collections',
    'collection_assets',
    'preview_jobs',
    'app_settings'
  ]) {
    assert.match(assetStore, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
  }
  assert.match(assetStore, /CREATE VIRTUAL TABLE IF NOT EXISTS asset_search\s+USING fts5/)
  assert.match(assetStore, /asset_search MATCH \?/)
  assert.match(assetStore, /BEGIN IMMEDIATE/)
  assert.match(assetStore, /migrateLegacy/)
  assert.match(assetStore, /Math\.min\(200, Math\.max\(1, query\.limit/)
  assert.match(assetStore, /resetRunningJobs/)
  assert.match(assetStore, /relinkPack/)
})

test('scanner accepts only media and classifies transition, overlay, and sound paths', () => {
  assert.match(assetScanner, /SUPPORTED_VIDEO_EXTENSIONS/)
  assert.match(assetScanner, /SUPPORTED_AUDIO_EXTENSIONS/)
  for (const term of [
    'transition',
    'wipe',
    'intro',
    'overlay',
    'leak',
    'grain',
    'particle',
    'dust'
  ])
    assert.match(assetScanner, new RegExp(term))
  assert.match(assetScanner, /mediaType === 'audio'\) return 'sound'/)
  assert.match(assetScanner, /metadata\.hasAlpha \? 'alpha' : 'raw'/)
})

test('main and preload own native drag, relink, jobs, and expose no raw Node bridge', () => {
  for (const surface of [
    'showOpenDialog',
    'openDirectory',
    'scanAssetPack',
    'generateAssetPreview',
    'shell.showItemInFolder',
    'sender.startDrag',
    'statSync',
    'RELINK_PACK_CHANNEL'
  ]) {
    assert.match(assetIpc, new RegExp(surface.replace('.', '\\.')))
  }
  assert.match(assetIpc, /claimPreviewJobs\(2\)/)
  assert.match(assetPreview, /Demo|color=c=0x1d3a4f/)
  assert.match(assetPreview, /blend=all_mode=screen/)
  assert.match(assetPreview, /showwavespic/)
  assert.match(assetPreview, /PREVIEW_PIPELINE_VERSION/)
  assert.match(assetPreview, /thumbnail\.webp/)
  assert.match(preload, /contextBridge\.exposeInMainWorld\('clipdock'/)
  assert.doesNotMatch(preload, /exposeInMainWorld\('(?:electron|api)'/)
  for (const method of ['queryAssets', 'relinkPack', 'regeneratePreviews', 'startAssetDrag'])
    assert.match(preload, new RegExp(`\\b${method}\\b`))
})

test('renderer is library-first, virtualized, keyboard accessible, and isolated from Node', () => {
  const renderer = [app, grid, sidebar, inspector, quickLook].join('\n')
  for (const forbidden of [/from ['"`]electron['"`]/, /from ['"`]node:/, /\bipcRenderer\b/])
    assert.doesNotMatch(renderer, forbidden)
  for (const surface of [
    'useVirtualizer',
    'AssetGrid',
    'AssetInspector',
    'AssetSidebar',
    'QuickLook',
    'startAssetDrag',
    'onDragStart',
    'onDrop',
    "event.key === '/'",
    "event.key === ' '",
    'ctrlKey',
    'shiftKey',
    'toggleAssetFavorite'
  ]) {
    assert.match(renderer, new RegExp(surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(grid, /slice\(-3\)/)
  assert.match(app, /setTimeout\(\(\) => setDebouncedSearch\(search\), 150\)/)
})

test('documentation defines the media-only product and cinematic utility design system', () => {
  for (const phrase of [
    'transition clips',
    'video overlays',
    'sound effects',
    'never moved, modified, or deleted',
    'DaVinci Resolve',
    'Adobe Premiere Pro'
  ])
    assert.match(readme, new RegExp(phrase, 'i'))
  for (const token of [
    '#0B0D10',
    '#15191F',
    '#2A313B',
    '#F2F5F7',
    '#8F9AA8',
    '#55C2FF',
    '#F6C85F',
    '#FF6B7A',
    'IBM Plex Sans',
    'IBM Plex Mono'
  ])
    assert.match(design, new RegExp(token, 'i'))
  assert.match(builder, /node_modules\/ffmpeg-static/)
  assert.match(builder, /node_modules\/ffprobe-static/)
  assert.match(builder, /publish:\s*null/)
})

function createIdGenerator(prefix = 'id') {
  let id = 0
  return () => `${prefix}-${String(++id).padStart(5, '0')}`
}

function compileRuntimeModules() {
  const scratchParent = join(projectRoot, 'tmp')
  mkdirSync(scratchParent, { recursive: true })
  const scratchRoot = mkdtempSync(join(scratchParent, 'clipdock-2-ts-'))
  const outDir = join(scratchRoot, 'compiled')
  const tsconfig = join(scratchRoot, 'tsconfig.json')
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'CommonJS',
        moduleResolution: 'Node',
        rootDir: projectRoot,
        outDir,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: false,
        noEmitOnError: true,
        types: ['node'],
        typeRoots: [join(projectRoot, 'node_modules', '@types')]
      },
      include: [
        join(projectRoot, 'src/main/libraryStore.ts'),
        join(projectRoot, 'src/main/assetStore.ts'),
        join(projectRoot, 'src/main/assetScanner.ts'),
        join(projectRoot, 'src/main/assetPreview.ts'),
        join(projectRoot, 'src/main/mediaProbe.ts'),
        join(projectRoot, 'src/main/thumbnailer.ts'),
        join(projectRoot, 'src/shared/clipdock.ts')
      ]
    })
  )
  const result = spawnSync(process.execPath, [tsc, '-p', tsconfig], {
    cwd: projectRoot,
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, `Runtime compile failed\n${result.stdout}\n${result.stderr}`)
  const requireCompiled = createRequire(join(outDir, 'src/main/assetStore.js'))
  return {
    scratchRoot,
    assetStore: requireCompiled(join(outDir, 'src/main/assetStore.js')),
    scanner: requireCompiled(join(outDir, 'src/main/assetScanner.js')),
    preview: requireCompiled(join(outDir, 'src/main/assetPreview.js')),
    legacyStore: requireCompiled(join(outDir, 'src/main/libraryStore.js'))
  }
}

function scannedAsset(packId, filePath, kind = 'transition') {
  return {
    packId,
    filePath,
    kind,
    mediaType: 'video',
    overlayMode: 'raw',
    compatibility: 'expected',
    sizeBytes: 10,
    modifiedAtMs: 100,
    durationMs: 1000,
    widthPixels: 1920,
    heightPixels: 1080,
    fps: 30,
    codec: 'h264',
    audioCodec: null,
    sampleRate: null,
    channels: null,
    hasAlpha: false,
    metadataJson: null
  }
}

test('asset store migrates legacy metadata, clamps pages, and preserves IDs while relinking', () => {
  const runtime = compileRuntimeModules()
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-store-'))
  const firstRoot = join(workspace, 'Old Pack')
  const nextRoot = join(workspace, 'New Pack')
  const managed = join(workspace, 'managed')
  const source = join(firstRoot, 'Transitions', 'wipe.mp4')
  const managedFile = join(managed, 'wipe.mp4')
  const databaseFile = join(workspace, 'library.sqlite')
  let store
  try {
    mkdirSync(join(firstRoot, 'Transitions'), { recursive: true })
    mkdirSync(join(nextRoot, 'Transitions'), { recursive: true })
    mkdirSync(managed, { recursive: true })
    writeFileSync(source, 'video')
    writeFileSync(managedFile, 'video')

    const legacy = runtime.legacyStore.openLibraryStore({
      databaseFile,
      libraryDir: managed,
      createId: createIdGenerator(),
      now: () => 100
    }).value
    const copied = legacy.createCopiedClipRecord({ sourceFile: source, managedFile })
    const clipId = copied.value.clip.id
    legacy.toggleFavorite(clipId)
    legacy.updateClipTags(clipId, ['fast', 'wipe'])
    legacy.updateClipNote(clipId, 'Between two clips')
    const collectionSnapshot = legacy.createBin('Hero effects')
    legacy.addClipsToBin([clipId], collectionSnapshot.value.bins[0].id)
    legacy.close()

    store = runtime.assetStore.openAssetStore({
      databaseFile,
      previewCacheDir: join(workspace, 'previews'),
      createId: createIdGenerator('asset'),
      now: () => 200
    }).value
    const migrated = store.queryAssets({ search: 'wipe' })
    assert.equal(migrated.value.totalCount, 1)
    assert.equal(migrated.value.items[0].favorite, true)
    assert.deepEqual(migrated.value.items[0].tags, ['fast', 'wipe'])
    assert.equal(migrated.value.items[0].note, 'Between two clips')
    assert.equal(store.queryAssets({ search: 'between' }).value.totalCount, 1)
    assert.equal(store.queryAssets({ search: 'fast' }).value.totalCount, 1)
    assert.equal(store.navigation().value.collections[0].name, 'Hero effects')

    const createdPack = store.createPack(firstRoot)
    assert.equal(createdPack.ok, true, createdPack.error?.message)
    const packId = createdPack.value
    const saved = store.upsertScannedAsset(scannedAsset(packId, source))
    copyFileSync(source, join(nextRoot, 'Transitions', 'wipe.mp4'))
    const relinked = store.relinkPack(packId, nextRoot)
    assert.equal(relinked.ok, true, relinked.error?.message)
    assert.equal(
      store.getAssetPath(saved.value.id).value.filePath,
      join(nextRoot, 'Transitions', 'wipe.mp4')
    )

    for (let index = 0; index < 205; index += 1)
      store.upsertScannedAsset(
        scannedAsset(packId, join(nextRoot, `item-${String(index).padStart(3, '0')}.mp4`))
      )
    const firstPage = store.queryAssets({ limit: 500, sort: 'name' })
    assert.equal(firstPage.value.items.length, 200)
    assert.ok(firstPage.value.nextCursor)
    const secondPage = store.queryAssets({
      limit: 200,
      cursor: firstPage.value.nextCursor,
      sort: 'name'
    })
    assert.ok(secondPage.value.items.length > 0)
  } finally {
    try {
      store?.close()
    } catch {
      // Preserve the primary assertion failure.
    }
    rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    rmSync(runtime.scratchRoot, { recursive: true, force: true })
  }
})

test('real mixed-media pack scan classifies assets, ignores unsupported files, and builds context previews', async () => {
  const runtime = compileRuntimeModules()
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-scan-'))
  const packRoot = join(workspace, 'Creator Pack')
  const transitions = join(packRoot, 'Transitions')
  const overlays = join(packRoot, 'Dust Overlays')
  const sounds = join(packRoot, 'SFX')
  const video = join(transitions, 'wipe-fast.mp4')
  const overlay = join(overlays, 'dust.mp4')
  const audio = join(sounds, 'impact.wav')
  const previewDir = join(workspace, 'previews')
  const requireProject = createRequire(join(projectRoot, 'package.json'))
  const ffmpeg = requireProject('ffmpeg-static')
  let store
  try {
    mkdirSync(transitions, { recursive: true })
    mkdirSync(overlays, { recursive: true })
    mkdirSync(sounds, { recursive: true })
    const videoResult = spawnSync(
      ffmpeg,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=160x90:rate=24',
        '-t',
        '0.6',
        '-pix_fmt',
        'yuv420p',
        video
      ],
      { encoding: 'utf8' }
    )
    assert.equal(videoResult.status, 0, videoResult.stderr)
    copyFileSync(video, overlay)
    const audioResult = spawnSync(
      ffmpeg,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:sample_rate=48000',
        '-t',
        '0.4',
        '-c:a',
        'pcm_s16le',
        audio
      ],
      { encoding: 'utf8' }
    )
    assert.equal(audioResult.status, 0, audioResult.stderr)
    writeFileSync(join(packRoot, 'preset.mogrt'), 'ignored')
    writeFileSync(join(packRoot, 'readme.txt'), 'ignored')

    store = runtime.assetStore.openAssetStore({
      databaseFile: join(workspace, 'library.sqlite'),
      previewCacheDir: previewDir,
      createId: createIdGenerator()
    }).value
    const packId = store.createPack(packRoot).value
    const pack = store.listPacks([packId]).value[0]
    const result = await runtime.scanner.scanAssetPack(store, pack)
    assert.equal(result.scannedFiles, 3)
    assert.equal(result.importedAssets, 3)
    const queried = store.queryAssets({ limit: 200 })
    assert.equal(queried.ok, true, queried.error?.message)
    const page = queried.value
    assert.deepEqual(page.items.map((asset) => asset.kind).sort(), [
      'overlay',
      'sound',
      'transition'
    ])
    const transition = page.items.find((asset) => asset.kind === 'transition')
    const sound = page.items.find((asset) => asset.kind === 'sound')
    assert.equal(transition.widthPixels, 160)
    assert.equal(sound.sampleRate, 48000)

    const transitionPreview = await runtime.preview.generateAssetPreview(transition, previewDir)
    const soundPreview = await runtime.preview.generateAssetPreview(sound, previewDir)
    assert.ok(existsSync(transitionPreview.previewPath))
    assert.ok(existsSync(transitionPreview.thumbnailPath))
    assert.ok(existsSync(soundPreview.thumbnailPath))
    assert.equal(soundPreview.previewPath, null)
  } finally {
    try {
      store?.close()
    } catch {
      // Preserve the primary assertion failure.
    }
    rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    rmSync(runtime.scratchRoot, { recursive: true, force: true })
  }
})
