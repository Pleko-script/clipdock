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
import test, { after } from 'node:test'

const projectRoot = process.cwd()
const read = (path) => readFileSync(join(projectRoot, path), 'utf8')
const packageJson = JSON.parse(read('package.json'))
const main = read('src/main/index.ts')
const ipc = read('src/main/assetIpc.ts')
const storeSource = read('src/main/assetStore.ts')
const schema = read('src/main/assetSchema.ts')
const preview = read('src/main/assetPreview.ts')
const preload = read('src/preload/index.ts')
const app = read('src/renderer/src/App.tsx')
const grid = read('src/renderer/src/components/AssetGrid.tsx')
const html = read('src/renderer/index.html')

function createIdGenerator(prefix = 'id') {
  let id = 0
  return () => `${prefix}-${String(++id).padStart(5, '0')}`
}

function compileRuntimeModules() {
  const scratchParent = join(projectRoot, 'tmp')
  mkdirSync(scratchParent, { recursive: true })
  const scratchRoot = mkdtempSync(join(scratchParent, 'clipdock-audit-ts-'))
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
        join(projectRoot, 'src/main/assetClassification.ts'),
        join(projectRoot, 'src/main/assetIpcValidation.ts'),
        join(projectRoot, 'src/main/assetPreview.ts'),
        join(projectRoot, 'src/main/assetScanner.ts'),
        join(projectRoot, 'src/main/assetSchema.ts'),
        join(projectRoot, 'src/main/assetSearch.ts'),
        join(projectRoot, 'src/main/assetStore.ts'),
        join(projectRoot, 'src/main/mediaProbe.ts'),
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
    classification: requireCompiled(join(outDir, 'src/main/assetClassification.js')),
    validation: requireCompiled(join(outDir, 'src/main/assetIpcValidation.js')),
    preview: requireCompiled(join(outDir, 'src/main/assetPreview.js')),
    scanner: requireCompiled(join(outDir, 'src/main/assetScanner.js')),
    store: requireCompiled(join(outDir, 'src/main/assetStore.js'))
  }
}

const runtime = compileRuntimeModules()
after(() => rmSync(runtime.scratchRoot, { recursive: true, force: true }))

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function createLegacyDatabase(databaseFile, rootPath, mediaPath) {
  const sql = `
    PRAGMA foreign_keys=OFF;
    CREATE TABLE library_sources (
      id TEXT PRIMARY KEY, kind TEXT, import_mode TEXT, status TEXT, display_name TEXT,
      source_path TEXT, normalized_source_path TEXT, target_path TEXT, normalized_target_path TEXT,
      created_at_ms INTEGER, updated_at_ms INTEGER, last_scanned_at_ms INTEGER,
      last_scan_started_at_ms INTEGER, last_scan_completed_at_ms INTEGER,
      last_error_code TEXT, last_error_message TEXT
    );
    CREATE TABLE clips (
      id TEXT PRIMARY KEY, source_id TEXT, import_mode TEXT, status TEXT, display_name TEXT,
      extension TEXT, source_path TEXT, normalized_source_path TEXT, target_path TEXT,
      normalized_target_path TEXT, folder_path TEXT, size_bytes INTEGER, modified_at_ms INTEGER,
      file_created_at_ms INTEGER, duration_ms INTEGER, width_pixels INTEGER, height_pixels INTEGER,
      fps REAL, codec TEXT, metadata_json TEXT, thumbnail_path TEXT, favorite INTEGER, note TEXT,
      rotation_degrees INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER,
      last_error_code TEXT, last_error_message TEXT
    );
    CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT, normalized_name TEXT UNIQUE, color TEXT, created_at_ms INTEGER, updated_at_ms INTEGER);
    CREATE TABLE clip_tags (clip_id TEXT, tag_id TEXT, created_at_ms INTEGER);
    CREATE TABLE bins (id TEXT PRIMARY KEY, name TEXT, normalized_name TEXT UNIQUE, sort_order INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER);
    CREATE TABLE clip_bins (clip_id TEXT, bin_id TEXT, created_at_ms INTEGER);
    INSERT INTO library_sources VALUES (
      'source-1','folder','linked-folder','active','Legacy Pack',${sqlString(rootPath)},${sqlString(rootPath.toLowerCase())},NULL,NULL,1,1,1,1,1,NULL,NULL
    );
    INSERT INTO clips VALUES (
      'clip-1','source-1','linked-folder','ready','wipe.mp4','.mp4',${sqlString(mediaPath)},${sqlString(mediaPath.toLowerCase())},NULL,NULL,${sqlString(rootPath)},10,100,1,1000,1920,1080,30,'h264',NULL,NULL,1,'legacy note',0,1,1,NULL,NULL
    );
    INSERT INTO tags VALUES ('tag-1','Fast','fast',NULL,1,1);
    INSERT INTO clip_tags VALUES ('clip-1','tag-1',1);
    INSERT INTO bins VALUES ('bin-1','Hero Effects','hero effects',0,1,1);
    INSERT INTO clip_bins VALUES ('clip-1','bin-1',1);
  `
  const script = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(${JSON.stringify(databaseFile)});db.exec(${JSON.stringify(sql)});db.close()`
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

test('repository has one canonical asset architecture', () => {
  for (const deleted of [
    'src/main/libraryIpc.ts',
    'src/main/libraryScanner.ts',
    'src/main/libraryStore.ts',
    'src/main/rotatedExport.ts',
    'src/renderer/src/components/ClipGrid.tsx',
    'src/renderer/src/components/PreviewStage.tsx'
  ])
    assert.equal(existsSync(join(projectRoot, deleted)), false, `${deleted} should stay removed`)
  assert.doesNotMatch(main, /registerLibraryIpc|libraryIpc/)
  assert.doesNotMatch(preload, /getLibrarySnapshot|prepareClipDrag|startClipDrag/)
  assert.doesNotMatch(read('src/shared/clipdock.ts'), /LibrarySnapshot|LibraryClipRecordSummary/)
  assert.ok(read('src/main/assetStore.ts').split(/\r?\n/).length < 1000)
})

test('Electron boundary is hardened and preserves media range headers', () => {
  for (const requirement of [
    /contextIsolation:\s*true/,
    /nodeIntegration:\s*false/,
    /sandbox:\s*true/,
    /webSecurity:\s*true/,
    /headers:\s*request\.headers/,
    /app\.clipdock\.desktop/
  ])
    assert.match(main, requirement)
  assert.match(html, /media-src[^;]*clipdock-media:/)
  assert.match(ipc, /statSync/)
  assert.match(ipc, /status !== 'ready'/)
  assert.match(
    ipc,
    /return withScanLock\(async \(\) => \{\s*const relinked = runtime\.store\.relinkPack/s
  )
})

test('IPC validation clamps and normalizes untrusted payloads', () => {
  const query = runtime.validation.parseAssetQuery({
    limit: 50_000,
    search: 'x'.repeat(500),
    kinds: ['transition', 'hacked'],
    formats: ['MP4', '.exe'],
    packIds: Array.from({ length: 100 }, (_, index) => `pack-${index}`),
    cursor: '-1',
    sort: 'DROP TABLE assets'
  })
  assert.equal(query.limit, 200)
  assert.equal(query.search.length, 256)
  assert.deepEqual(query.kinds, ['transition'])
  assert.deepEqual(query.formats, ['.mp4'])
  assert.equal(query.packIds.length, 64)
  assert.equal(query.cursor, undefined)
  assert.equal(query.sort, 'name')

  const update = runtime.validation.parseAssetUpdate({
    assetIds: ['a', 'a', '', 42],
    kind: 'malware',
    overlayMode: 'screen',
    tags: [' one ', 'one', 'two'],
    note: 'n'.repeat(5000)
  })
  assert.deepEqual(update.assetIds, ['a'])
  assert.equal(update.kind, undefined)
  assert.equal(update.overlayMode, 'screen')
  assert.deepEqual(update.tags, ['one', 'two'])
  assert.equal(update.note.length, 4000)
})

test('classification uses pack-relative paths and accepts media only', () => {
  assert.equal(runtime.classification.assetMediaType('clip.MP4'), 'video')
  assert.equal(runtime.classification.assetMediaType('impact.WAV'), 'audio')
  assert.equal(runtime.classification.assetMediaType('preset.mogrt'), null)
  assert.equal(
    runtime.classification.inferAssetKind('Transitions/wipe-fast.mp4', 'video'),
    'transition'
  )
  assert.equal(
    runtime.classification.inferAssetKind('Dust Overlays/particle.mov', 'video'),
    'overlay'
  )
  assert.equal(runtime.classification.inferAssetKind('plain/clip.mp4', 'video'), 'unknown')
  assert.equal(runtime.classification.inferAssetKind('anything.wav', 'audio'), 'sound')
})

test('legacy migration preserves metadata and new updates are atomic', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-store-audit-'))
  const packRoot = join(workspace, 'Legacy Pack')
  const mediaPath = join(packRoot, 'wipe.mp4')
  const databaseFile = join(workspace, 'library.sqlite')
  let store
  try {
    mkdirSync(packRoot, { recursive: true })
    writeFileSync(mediaPath, 'video')
    createLegacyDatabase(databaseFile, packRoot, mediaPath)
    const opened = runtime.store.openAssetStore({
      databaseFile,
      previewCacheDir: join(workspace, 'previews'),
      createId: createIdGenerator('asset'),
      now: () => 200
    })
    assert.equal(opened.ok, true, opened.error?.message)
    store = opened.value

    const migrated = store.queryAssets({ search: 'wipe' })
    assert.equal(migrated.ok, true, migrated.error?.message)
    assert.equal(migrated.value.totalCount, 1)
    assert.equal(migrated.value.items[0].favorite, true)
    assert.equal(migrated.value.items[0].note, 'legacy note')
    assert.deepEqual(migrated.value.items[0].tags, ['Fast'])
    assert.deepEqual(migrated.value.items[0].collectionIds, ['bin-1'])

    const rejectedUpdate = store.updateAssets({
      assetIds: ['clip-1', 'missing'],
      note: 'must roll back'
    })
    assert.equal(rejectedUpdate.ok, false)
    assert.equal(store.getAsset('clip-1').value.note, 'legacy note')

    assert.equal(store.createCollection('Atomic').ok, true)
    const collectionId = store
      .navigation()
      .value.collections.find((item) => item.name === 'Atomic').id
    const rejectedMembership = store.addAssetsToCollection(['clip-1', 'missing'], collectionId)
    assert.equal(rejectedMembership.ok, false)
    assert.equal(store.getAsset('clip-1').value.collectionIds.includes(collectionId), false)

    const claimed = store.claimPreviewJobs(2)
    assert.equal(claimed.ok, true)
    if (claimed.value[0]) {
      assert.equal(store.completePreview('clip-1', 'thumb.webp', 'preview.mp4').ok, true)
    }
    const rejectedQueue = store.enqueuePreview(['clip-1', 'missing'])
    assert.equal(rejectedQueue.ok, false)
    assert.equal(store.getAsset('clip-1').value.previewStatus, 'ready')
  } finally {
    try {
      store?.close()
    } catch {
      /* preserve assertions */
    }
    rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('mixed-media scan ignores unsupported files and builds cached previews', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-media-audit-'))
  const packRoot = join(workspace, 'Pack')
  const transitions = join(packRoot, 'Transitions')
  const overlays = join(packRoot, 'Overlays')
  const sounds = join(packRoot, 'SFX')
  const video = join(transitions, 'wipe.mp4')
  const overlay = join(overlays, 'dust.mp4')
  const audio = join(sounds, 'impact.wav')
  const previewDir = join(workspace, 'previews')
  const ffmpeg = createRequire(join(projectRoot, 'package.json'))('ffmpeg-static')
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
    writeFileSync(join(packRoot, 'ignored.mogrt'), 'ignored')

    store = runtime.store.openAssetStore({
      databaseFile: join(workspace, 'library.sqlite'),
      previewCacheDir: previewDir,
      createId: createIdGenerator('media')
    }).value
    const packId = store.createPack(packRoot).value
    const result = await runtime.scanner.scanAssetPack(store, store.listPacks([packId]).value[0])
    assert.equal(result.scannedFiles, 3)
    const assets = store.queryAssets({ limit: 200 }).value.items
    assert.deepEqual(assets.map((asset) => asset.kind).sort(), ['overlay', 'sound', 'transition'])

    const transition = assets.find((asset) => asset.kind === 'transition')
    const sound = assets.find((asset) => asset.kind === 'sound')
    const transitionPreview = await runtime.preview.generateAssetPreview(transition, previewDir)
    const soundPreview = await runtime.preview.generateAssetPreview(sound, previewDir)
    assert.match(transitionPreview.thumbnailPath, /\.webp$/)
    assert.ok(existsSync(transitionPreview.previewPath))
    assert.ok(existsSync(soundPreview.thumbnailPath))
    assert.equal(soundPreview.previewPath, null)
  } finally {
    try {
      store?.close()
    } catch {
      /* preserve assertions */
    }
    rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('renderer is virtualized, scoped, and contains no privileged imports', () => {
  const renderer = [app, grid, read('src/renderer/src/components/AssetSidebar.tsx')].join('\n')
  assert.doesNotMatch(renderer, /from ['"`]electron['"`]|from ['"`]node:|ipcRenderer/)
  assert.match(grid, /useVirtualizer/)
  assert.match(app, /type LibraryScope/)
  assert.match(app, /scheduleRefresh/)
  assert.doesNotMatch(app, /title="Filters"/)
})

test('package, docs, and preview pipeline describe the shipped system', () => {
  for (const dependency of ['ffmpeg-static', 'ffprobe-static', '@tanstack/react-virtual']) {
    assert.ok(packageJson.dependencies[dependency])
  }
  assert.match(schema, /BEGIN IMMEDIATE/)
  assert.match(storeSource, /private transaction/)
  assert.match(preview, /PREVIEW_PIPELINE_VERSION = 3/)
  assert.match(preview, /color=black@0/)
  assert.match(read('README.md'), /never moved, modified, or deleted/i)
  assert.match(read('DESIGN.md'), /#0B0D10/i)
})
