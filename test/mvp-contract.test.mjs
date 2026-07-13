/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { after } from 'node:test'

const projectRoot = process.cwd()
const read = (path) => readFileSync(join(projectRoot, path), 'utf8')
const packageJson = JSON.parse(read('package.json'))
const main = read('src/main/index.ts')
const ipc = read('src/main/assetIpc.ts')
const storeSource = read('src/main/assetStore.ts')
const schema = read('src/main/assetSchema.ts')
const preview = read('src/main/assetPreview.ts')
const trim = read('src/main/assetTrim.ts')
const preload = read('src/preload/index.ts')
const app = read('src/renderer/src/App.tsx')
const grid = read('src/renderer/src/components/AssetGrid.tsx')
const filterUi = read('src/renderer/src/components/AssetFilters.tsx')
const inspector = read('src/renderer/src/components/AssetInspector.tsx')
const trimEditor = read('src/renderer/src/components/AssetTrimEditor.tsx')
const i18n = read('src/renderer/src/i18n.tsx')
const rendererCss = [
  read('src/renderer/src/assets/base.css'),
  read('src/renderer/src/assets/main.css'),
  read('src/renderer/src/assets/trim.css')
].join('\n')
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
        join(projectRoot, 'src/main/assetQuery.ts'),
        join(projectRoot, 'src/main/assetTrim.ts'),
        join(projectRoot, 'src/main/assetTrimStore.ts'),
        join(projectRoot, 'src/main/assetScanner.ts'),
        join(projectRoot, 'src/main/assetSchema.ts'),
        join(projectRoot, 'src/main/assetSearch.ts'),
        join(projectRoot, 'src/main/assetStore.ts'),
        join(projectRoot, 'src/main/mediaProbe.ts'),
        join(projectRoot, 'src/main/mediaProcess.ts'),
        join(projectRoot, 'src/shared/clipdock.ts'),
        join(projectRoot, 'src/shared/assetFilters.ts')
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
    filters: requireCompiled(join(outDir, 'src/shared/assetFilters.js')),
    classification: requireCompiled(join(outDir, 'src/main/assetClassification.js')),
    validation: requireCompiled(join(outDir, 'src/main/assetIpcValidation.js')),
    preview: requireCompiled(join(outDir, 'src/main/assetPreview.js')),
    trim: requireCompiled(join(outDir, 'src/main/assetTrim.js')),
    scanner: requireCompiled(join(outDir, 'src/main/assetScanner.js')),
    store: requireCompiled(join(outDir, 'src/main/assetStore.js')),
    probe: requireCompiled(join(outDir, 'src/main/mediaProbe.js'))
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
  assert.ok(read('src/main/assetStore.ts').split(/\r?\n/).length < 1100)
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
    /event\.sender\.startDrag\(dragItem\)[\s\S]*recordAssetUsage\(assetIds\)[\s\S]*type: 'drag-started'/
  )
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

  const usageQuery = runtime.validation.parseAssetQuery({ usedOnly: true, sort: 'most-used' })
  assert.equal(usageQuery.usedOnly, true)
  assert.equal(usageQuery.sort, 'most-used')

  const facetQuery = runtime.validation.parseAssetQuery({
    categoryPaths: ['Overlays/Dust', 42],
    aspects: ['portrait', 'hacked'],
    durationBuckets: ['under-1s', 'DROP TABLE assets'],
    overlayModes: ['alpha', 'invalid'],
    audioStates: ['with-audio', 'invalid'],
    codecs: ['H264', '', 42],
    statuses: ['missing', 'removed'],
    previewStatuses: ['failed', 'running']
  })
  assert.deepEqual(facetQuery.categoryPaths, ['Overlays/Dust'])
  assert.deepEqual(facetQuery.aspects, ['portrait'])
  assert.deepEqual(facetQuery.durationBuckets, ['under-1s'])
  assert.deepEqual(facetQuery.overlayModes, ['alpha'])
  assert.deepEqual(facetQuery.audioStates, ['with-audio'])
  assert.deepEqual(facetQuery.codecs, ['h264'])
  assert.deepEqual(facetQuery.statuses, ['missing'])
  assert.deepEqual(facetQuery.previewStatuses, ['failed'])

  const emptyFilters = runtime.filters.emptyAssetFilters()
  const withKind = runtime.filters.toggleAssetFilter(emptyFilters, 'kinds', 'overlay')
  const combined = runtime.filters.toggleAssetFilter(withKind, 'formats', '.mov')
  const removed = runtime.filters.toggleAssetFilter(combined, 'kinds', 'overlay')
  const restored = runtime.filters.toggleAssetFilter(removed, 'kinds', 'overlay')
  assert.equal(runtime.filters.countAssetFilters(combined), 2)
  assert.deepEqual(runtime.filters.assetFiltersToQuery(removed), { formats: ['.mov'] })
  assert.deepEqual(restored, combined)
  assert.deepEqual(runtime.filters.emptyAssetFilters(), emptyFilters)

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

  assert.deepEqual(
    runtime.validation.parseAssetTrim({
      assetId: ' clip ',
      startMs: 101.4,
      endMs: 900,
      rotationDegrees: 90
    }),
    {
      assetId: 'clip',
      startMs: 101,
      endMs: 900,
      rotationDegrees: 90
    }
  )
  assert.deepEqual(
    runtime.validation.parseAssetTrim({
      assetId: {},
      startMs: '10',
      endMs: Infinity,
      rotationDegrees: 45
    }),
    {
      assetId: '',
      startMs: null,
      endMs: null,
      rotationDegrees: 0
    }
  )
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
  const secondMediaPath = join(packRoot, 'impact.mp4')
  const databaseFile = join(workspace, 'library.sqlite')
  let clock = 200
  let store
  try {
    mkdirSync(packRoot, { recursive: true })
    writeFileSync(mediaPath, 'video')
    writeFileSync(secondMediaPath, 'video 2')
    createLegacyDatabase(databaseFile, packRoot, mediaPath)
    const opened = runtime.store.openAssetStore({
      databaseFile,
      previewCacheDir: join(workspace, 'previews'),
      createId: createIdGenerator('asset'),
      now: () => clock
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
    assert.equal(migrated.value.items[0].trimStatus, 'none')
    assert.equal(migrated.value.items[0].trimStartMs, null)
    assert.equal(migrated.value.items[0].rotationDegrees, 0)
    assert.equal(migrated.value.items[0].lastUsedAtMs, null)
    assert.equal(migrated.value.items[0].useCount, 0)

    const secondAsset = store.upsertScannedAsset({
      packId: 'source-1',
      filePath: secondMediaPath,
      kind: 'transition',
      mediaType: 'video',
      overlayMode: 'raw',
      compatibility: 'expected',
      sizeBytes: 7,
      modifiedAtMs: 100,
      durationMs: 500,
      widthPixels: 1920,
      heightPixels: 1080,
      fps: 30,
      codec: 'h264',
      audioCodec: null,
      sampleRate: null,
      channels: null,
      hasAlpha: false,
      metadataJson: null
    })
    assert.equal(secondAsset.ok, true, secondAsset.error?.message)

    const faceted = store.queryAssets({
      kinds: ['unknown', 'transition'],
      aspects: ['landscape'],
      durationBuckets: ['under-1s', '1-3s'],
      codecs: ['h264']
    })
    assert.equal(faceted.ok, true, faceted.error?.message)
    assert.equal(faceted.value.totalCount, 2)
    assert.deepEqual(
      faceted.value.facets.kinds.map(({ value, count }) => [value, count]),
      [
        ['transition', 1],
        ['unknown', 1]
      ]
    )
    assert.deepEqual(
      faceted.value.facets.packs.map(({ label, count }) => [label, count]),
      [['Legacy Pack', 2]]
    )
    assert.deepEqual(
      faceted.value.facets.categories.map(({ value, count }) => [value, count]),
      [['', 2]]
    )
    assert.deepEqual(store.queryAssets({ aspects: ['portrait'] }).value.items, [])

    clock = 300
    assert.equal(store.recordAssetUsage(['clip-1']).ok, true)
    clock = 400
    assert.equal(
      store.recordAssetUsage(['clip-1', secondAsset.value.id, secondAsset.value.id]).ok,
      true
    )
    clock = 500
    assert.equal(store.recordAssetUsage([secondAsset.value.id]).ok, true)
    clock = 600
    assert.equal(store.recordAssetUsage([secondAsset.value.id]).ok, true)
    const beforeRejectedUsage = store.getAsset('clip-1').value
    assert.equal(store.recordAssetUsage(['clip-1', 'missing']).ok, false)
    assert.equal(store.getAsset('clip-1').value.useCount, beforeRejectedUsage.useCount)

    const lastUsed = store.queryAssets({ usedOnly: true, sort: 'last-used' }).value
    assert.equal(lastUsed.totalCount, 2)
    assert.deepEqual(
      lastUsed.items.map((asset) => asset.id),
      [secondAsset.value.id, 'clip-1']
    )
    assert.equal(lastUsed.items[0].lastUsedAtMs, 600)
    assert.equal(lastUsed.items[0].useCount, 3)
    assert.equal(lastUsed.items[1].lastUsedAtMs, 400)
    assert.equal(lastUsed.items[1].useCount, 2)
    assert.deepEqual(
      store.queryAssets({ sort: 'most-used' }).value.items.map((asset) => asset.id),
      [secondAsset.value.id, 'clip-1']
    )
    assert.equal(store.navigation().value.usedAssetCount, 2)

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

    assert.equal(store.beginTrim('clip-1', 100, 500, 0).ok, true)
    assert.equal(store.beginTrim('clip-1', 200, 600, 90).ok, true)
    assert.equal(store.completeTrim('clip-1', 100, 500, 0, 'stale.mp4').ok, false)
    assert.equal(store.getAsset('clip-1').value.trimStartMs, 200)
    assert.equal(store.getAsset('clip-1').value.rotationDegrees, 90)
    assert.equal(store.getAsset('clip-1').value.trimStatus, 'pending')
    assert.equal(store.clearTrim('clip-1').ok, true)
  } finally {
    try {
      store?.close()
    } catch {
      /* preserve assertions */
    }
    rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

test('faceted first-page query stays responsive with 10,000 assets', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-facet-performance-'))
  const packRoot = join(workspace, 'Synthetic Pack')
  const databaseFile = join(workspace, 'library.sqlite')
  let store
  try {
    mkdirSync(packRoot, { recursive: true })
    store = runtime.store.openAssetStore({
      databaseFile,
      previewCacheDir: join(workspace, 'previews'),
      createId: createIdGenerator('facet')
    }).value
    const packId = store.createPack(packRoot).value
    store.close()
    store = null

    const database = new DatabaseSync(databaseFile)
    const insert = database.prepare(`
      INSERT INTO assets (
        id, pack_id, relative_path, category_path, display_name, file_path,
        normalized_file_path, extension, kind, media_type, overlay_mode,
        size_bytes, modified_at_ms, duration_ms, width_pixels, height_pixels, fps,
        codec, audio_codec, sample_rate, channels, has_alpha, created_at_ms, updated_at_ms
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const kinds = ['transition', 'overlay', 'sound', 'unknown']
    const durations = [500, 2000, 5000, 12000]
    database.exec('BEGIN IMMEDIATE')
    for (let index = 0; index < 10_000; index += 1) {
      const kind = kinds[index % kinds.length]
      const audio = kind === 'sound'
      const orientation = index % 3
      const width = audio ? null : orientation === 0 ? 1080 : orientation === 1 ? 1920 : 1080
      const height = audio ? null : orientation === 0 ? 1920 : orientation === 1 ? 1080 : 1080
      const extension = audio ? '.wav' : index % 2 ? '.mp4' : '.mov'
      const relativePath = `Category ${index % 12}/asset-${index}${extension}`
      const filePath = join(packRoot, relativePath)
      insert.run(
        `asset-${index}`,
        packId,
        relativePath,
        `Category ${index % 12}`,
        `asset-${index}`,
        filePath,
        filePath.toLocaleLowerCase('en-US'),
        extension,
        kind,
        audio ? 'audio' : 'video',
        kind === 'overlay' ? (index % 2 ? 'screen' : 'alpha') : 'raw',
        1000 + index,
        index,
        durations[Math.floor(index / kinds.length) % durations.length],
        width,
        height,
        audio ? null : 30,
        audio ? null : index % 2 ? 'h264' : 'prores',
        audio ? 'pcm_s16le' : null,
        audio ? 48000 : null,
        audio ? 2 : null,
        kind === 'overlay' && index % 2 === 0 ? 1 : 0,
        index,
        index
      )
    }
    database.exec('COMMIT')
    database.close()

    store = runtime.store.openAssetStore({
      databaseFile,
      previewCacheDir: join(workspace, 'previews')
    }).value
    const started = performance.now()
    const result = store.queryAssets({
      limit: 200,
      kinds: ['transition', 'overlay'],
      aspects: ['portrait', 'landscape'],
      durationBuckets: ['under-1s', '1-3s'],
      formats: ['.mp4', '.mov'],
      codecs: ['h264', 'prores'],
      statuses: ['ready'],
      previewStatuses: ['pending']
    })
    const elapsed = performance.now() - started
    assert.equal(result.ok, true, result.error?.message)
    assert.equal(result.value.items.length, 200)
    assert.ok(result.value.totalCount > 200)
    assert.equal(result.value.nextCursor, '200')
    assert.ok(result.value.facets.packs[0].count > 0)
    assert.ok(result.value.facets.aspects.some((option) => option.value === 'square'))
    assert.ok(result.value.facets.kinds.some((option) => option.value === 'unknown'))
    assert.ok(elapsed < 100, `First faceted page took ${elapsed.toFixed(1)} ms`)
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
  const overlay = join(overlays, 'dust.mov')
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
    const overlayResult = spawnSync(
      ffmpeg,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=red@0.5:s=160x90:r=24,format=rgba',
        '-t',
        '0.6',
        '-c:v',
        'prores_ks',
        '-profile:v',
        '4',
        '-pix_fmt',
        'yuva444p10le',
        overlay
      ],
      { encoding: 'utf8' }
    )
    assert.equal(overlayResult.status, 0, overlayResult.stderr)
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
    const alphaOverlay = assets.find((asset) => asset.kind === 'overlay')
    const sound = assets.find((asset) => asset.kind === 'sound')
    assert.equal(alphaOverlay.hasAlpha, true)
    assert.equal(alphaOverlay.overlayMode, 'alpha')
    assert.deepEqual(
      store.queryAssets({ overlayModes: ['alpha'] }).value.items.map((asset) => asset.id),
      [alphaOverlay.id]
    )
    assert.deepEqual(
      store.queryAssets({ audioStates: ['with-audio'] }).value.items.map((asset) => asset.id),
      [sound.id]
    )
    assert.equal(store.queryAssets({ formats: ['.mov', '.wav'] }).value.totalCount, 2)
    assert.equal(
      store.queryAssets({ statuses: ['ready'], previewStatuses: ['pending'] }).value.totalCount,
      3
    )
    const transitionPreview = await runtime.preview.generateAssetPreview(transition, previewDir)
    const soundPreview = await runtime.preview.generateAssetPreview(sound, previewDir)
    assert.match(transitionPreview.thumbnailPath, /\.webp$/)
    assert.ok(existsSync(transitionPreview.previewPath))
    assert.ok(existsSync(soundPreview.thumbnailPath))
    assert.equal(soundPreview.previewPath, null)

    const begunTrim = store.beginTrim(transition.id, 100, 500, 0)
    assert.equal(begunTrim.ok, true, begunTrim.error?.message)
    const trimmedPath = await runtime.trim.generateTrimmedAsset(
      begunTrim.value,
      100,
      500,
      0,
      join(workspace, 'trimmed')
    )
    assert.ok(existsSync(trimmedPath))
    assert.match(trimmedPath, /-range-0\.100-0\.500-r0-[a-f0-9]{20}\.mp4$/)
    assert.equal(store.completeTrim(transition.id, 100, 500, 0, trimmedPath).ok, true)
    const trimmed = store.getAsset(transition.id).value
    assert.equal(trimmed.trimStartMs, 100)
    assert.equal(trimmed.trimEndMs, 500)
    assert.equal(trimmed.trimStatus, 'ready')
    assert.equal(store.getAssetPath(transition.id).value.trimmedPath, trimmedPath)
    const trimmedMetadata = await runtime.probe.probeMedia(trimmedPath)
    assert.ok(trimmedMetadata.durationMs >= 350 && trimmedMetadata.durationMs <= 500)

    const begunRotation = store.beginTrim(transition.id, null, null, 90)
    assert.equal(begunRotation.ok, true, begunRotation.error?.message)
    const rotatedPath = await runtime.trim.generateTrimmedAsset(
      begunRotation.value,
      0,
      begunRotation.value.durationMs,
      90,
      join(workspace, 'trimmed')
    )
    assert.equal(store.completeTrim(transition.id, null, null, 90, rotatedPath).ok, true)
    const rotatedMetadata = await runtime.probe.probeMedia(rotatedPath)
    assert.equal(rotatedMetadata.widthPixels, 90)
    assert.equal(rotatedMetadata.heightPixels, 160)
    assert.equal(store.getAsset(transition.id).value.rotationDegrees, 90)

    const begunAlphaTrim = store.beginTrim(alphaOverlay.id, 100, 500, 90)
    assert.equal(begunAlphaTrim.ok, true, begunAlphaTrim.error?.message)
    const alphaTrimmedPath = await runtime.trim.generateTrimmedAsset(
      begunAlphaTrim.value,
      100,
      500,
      90,
      join(workspace, 'trimmed')
    )
    assert.match(alphaTrimmedPath, /\.mov$/)
    assert.equal(store.completeTrim(alphaOverlay.id, 100, 500, 90, alphaTrimmedPath).ok, true)
    const alphaMetadata = await runtime.probe.probeMedia(alphaTrimmedPath)
    assert.equal(alphaMetadata.hasAlpha, true)
    assert.equal(alphaMetadata.widthPixels, 90)
    assert.equal(alphaMetadata.heightPixels, 160)
    assert.ok(alphaMetadata.durationMs >= 350 && alphaMetadata.durationMs <= 500)
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
  const renderer = [app, grid, filterUi, read('src/renderer/src/components/AssetSidebar.tsx')].join(
    '\n'
  )
  assert.doesNotMatch(renderer, /from ['"`]electron['"`]|from ['"`]node:|ipcRenderer/)
  assert.match(grid, /useVirtualizer/)
  assert.match(app, /type LibraryScope/)
  assert.match(app, /scheduleRefresh/)
  assert.match(trimEditor, /role="slider"/)
  assert.match(trimEditor, /trim-range-thumb in/)
  assert.match(trimEditor, /trim-range-thumb out/)
  assert.match(trimEditor, /handleSliderKey/)
  assert.match(trimEditor, /onPointerMove/)
  assert.match(trimEditor, /trim\.rotateRight/)
  assert.match(trimEditor, /rotationDegrees/)
  assert.match(trimEditor, /clipdock\.previewVolume/)
  assert.match(trimEditor, /trim-volume-control/)
  assert.ok(app.indexOf('<AssetInspector') < app.indexOf('<div className="asset-results-bar">'))
  assert.doesNotMatch(inspector, />\s*Notes\s*</)
  assert.doesNotMatch(inspector, /<details/)
  assert.match(inspector, /asset-editor-layout/)
  assert.match(i18n, /clipdock\.language/)
  assert.match(i18n, /'sidebar\.language': 'Sprache'/)
  assert.match(i18n, /'sidebar\.language': 'Language'/)
  assert.match(app, /type: 'recent'/)
  assert.match(app, /value="last-used"/)
  assert.match(app, /value="most-used"/)
  assert.match(renderer, /sidebar\.recentlyUsed/)
  assert.match(filterUi, /asset-filter-popover/)
  assert.match(filterUi, /asset-filter-chips/)
  assert.match(filterUi, /filter\.clearAll/)
  assert.match(filterUi, /type="checkbox"/)
})

test('package, docs, and preview pipeline describe the shipped system', () => {
  for (const dependency of [
    'ffmpeg-static',
    'ffprobe-static',
    '@tanstack/react-virtual',
    '@fontsource-variable/commissioner',
    '@fontsource/fragment-mono'
  ]) {
    assert.ok(packageJson.dependencies[dependency])
  }
  assert.match(schema, /BEGIN IMMEDIATE/)
  assert.match(schema, /rotation_degrees=0 WHERE rotation_degrees IS NULL/)
  assert.match(storeSource, /private transaction/)
  assert.match(preview, /PREVIEW_PIPELINE_VERSION = 3/)
  assert.match(preview, /color=black@0/)
  assert.match(trim, /prores_ks/)
  assert.match(trim, /libx264/)
  assert.match(read('README.md'), /never moved, modified, or deleted/i)
  assert.match(read('DESIGN.md'), /#080909/i)
  assert.doesNotMatch(rendererCss, /#55c2ff|85,\s*194,\s*255/i)
  assert.match(rendererCss, /grid-template-columns:\s*214px minmax\(0, 1fr\)/)
  assert.doesNotMatch(
    rendererCss,
    /minmax\(0, 1fr\) 460px|position:\s*fixed;[\s\S]{0,180}\.asset-inspector/
  )
  assert.match(rendererCss, /\.trim-media-stage[\s\S]*aspect-ratio:\s*1/)
  assert.match(rendererCss, /\.trim-media-stage video[\s\S]*object-fit:\s*contain/)
  assert.match(rendererCss, /\.asset-editor-layout[\s\S]*grid-template-columns:/)
  assert.match(rendererCss, /\.asset-inspector[\s\S]*overflow:\s*hidden/)
})
