/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

const projectRoot = process.cwd()

function read(relativePath) {
  return readFileSync(join(projectRoot, relativePath), 'utf8')
}

const packageJson = JSON.parse(read('package.json'))
const shared = read('src/shared/clipdock.ts')
const main = read('src/main/index.ts')
const store = read('src/main/libraryStore.ts')
const ipc = read('src/main/libraryIpc.ts')
const preload = read('src/preload/index.ts')
const app = read('src/renderer/src/App.tsx')
const previewStage = read('src/renderer/src/components/PreviewStage.tsx')
const sidebarComponent = read('src/renderer/src/components/Sidebar.tsx')
const clipGridComponent = read('src/renderer/src/components/ClipGrid.tsx')
const contextMenuComponent = read('src/renderer/src/components/ContextMenu.tsx')
const html = read('src/renderer/index.html')
const builder = read('electron-builder.yml')
const readme = read('README.md')

const supportedExtensions = [
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
]

test('package exposes runnable MVP scripts and bundled media tooling', () => {
  assert.equal(packageJson.scripts.dev, 'electron-vite dev')
  assert.equal(packageJson.scripts.build, 'npm run typecheck && electron-vite build')
  assert.equal(packageJson.scripts.typecheck, 'npm run typecheck:node && npm run typecheck:web')
  assert.equal(packageJson.scripts['test:mvp'], 'node --test test/mvp-contract.test.mjs')
  assert.ok(packageJson.dependencies['ffmpeg-static'])
  assert.ok(packageJson.dependencies['ffprobe-static'])
  assert.doesNotMatch(
    JSON.stringify(packageJson),
    /electron-updater|example\.com|electron-vite\.org/
  )
})

test('Electron window stays hardened and assets use a constrained custom protocol', () => {
  assert.match(main, /contextIsolation:\s*true/)
  assert.match(main, /nodeIntegration:\s*false/)
  assert.match(main, /sandbox:\s*true/)
  assert.match(main, /webSecurity:\s*true/)
  assert.match(main, /protocol\.registerSchemesAsPrivileged/)
  assert.match(main, /protocol\.handle\('clipdock-media'/)
  assert.match(html, /img-src[^;]*clipdock-media:/)
  assert.match(html, /media-src[^;]*clipdock-media:/)
})

test('shared contract covers the requested ClipDock MVP features', () => {
  for (const extension of supportedExtensions) {
    assert.match(shared, new RegExp(`['"\`]${extension.replace('.', '\\.')}['"\`]`))
  }

  for (const surface of [
    'durationMs',
    'widthPixels',
    'heightPixels',
    'fps',
    'codec',
    'thumbnailUrl',
    'previewUrl',
    'favorite',
    'tags',
    'note',
    'ScanEvent',
    'ClipDragRequest',
    'LibraryBinRecordSummary',
    'ClipRotationDegrees',
    'binIds',
    'rotationDegrees',
    'bins',
    'createBin',
    'renameBin',
    'deleteBin',
    'addClipsToBin',
    'moveClipsToBin',
    'removeClipsFromBin',
    'removeClipsFromLibrary',
    'updateClipRotation',
    'prepareClipDrag'
  ]) {
    assert.match(shared, new RegExp(`\\b${surface}\\b`))
  }
})

test('SQLite store persists folders, clips, tags, marks, metadata, thumbnails, and FTS', () => {
  for (const table of ['library_sources', 'clips', 'tags', 'clip_tags', 'clip_marks']) {
    assert.match(store, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
  }

  for (const table of ['bins', 'clip_bins', 'clip_exports']) {
    assert.match(store, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
  }

  for (const field of [
    'duration_ms',
    'width_pixels',
    'height_pixels',
    'fps',
    'codec',
    'thumbnail_path',
    'favorite',
    'note',
    'rotation_degrees',
    'binIds',
    'rotationDegrees'
  ]) {
    assert.match(store, new RegExp(`\\b${field}\\b`))
  }

  assert.match(store, /CREATE VIRTUAL TABLE IF NOT EXISTS clip_search\s+USING fts5/)
  assert.match(store, /updateClipTags/)
  assert.match(store, /updateClipNote/)
  assert.match(store, /toggleFavorite/)
})

test('main process owns dialogs, scanning, thumbnailing, reveal, clipboard, and native drag', () => {
  assert.match(ipc, /showOpenDialog/)
  assert.match(ipc, /openDirectory/)
  assert.match(ipc, /multiSelections/)
  assert.match(ipc, /scanLibrary/)
  assert.match(ipc, /thumbnailCacheDir/)
  assert.match(ipc, /shell\.showItemInFolder/)
  assert.match(ipc, /clipboard\.writeText/)
  assert.match(ipc, /sender\.startDrag/)
  assert.match(ipc, /validateClipFile/)
  assert.match(ipc, /resolveRotatedExportPath/)
  assert.match(ipc, /exportCacheDir/)
  assert.match(ipc, /PREPARE_CLIP_DRAG_CHANNEL/)
  assert.match(ipc, /START_CLIP_DRAG_CHANNEL/)
  assert.match(ipc, /resolvePreparedDragFile/)
  assert.match(ipc, /statSync/)
  assert.match(ipc, /function startClipDrag\(/)
  assert.doesNotMatch(ipc, /async function startClipDrag\(/)
  assert.match(app, /event\.preventDefault\(\)\s*event\.dataTransfer[\s\S]*api\.startClipDrag/)
})

test('preload exposes only the typed clipdock bridge and no raw node/electron API', () => {
  assert.match(preload, /contextBridge\.exposeInMainWorld\('clipdock'/)
  assert.doesNotMatch(preload, /exposeInMainWorld\('(?:electron|api)'/)
  assert.match(preload, /getLibrarySnapshot/)
  assert.match(preload, /addLinkedFolder/)
  assert.match(preload, /rescanLibrary/)
  assert.match(preload, /toggleFavorite/)
  assert.match(preload, /updateClipTags/)
  assert.match(preload, /updateClipNote/)
  assert.match(preload, /startClipDrag/)
  for (const method of [
    'createBin',
    'renameBin',
    'deleteBin',
    'addClipsToBin',
    'moveClipsToBin',
    'removeClipsFromBin',
    'removeClipsFromLibrary',
    'updateClipRotation',
    'prepareClipDrag'
  ]) {
    assert.match(preload, new RegExp(`\\b${method}\\b`))
  }
})

test('renderer implements the main visual workflow without direct Node access', () => {
  const rendererSurface = [
    app,
    previewStage,
    sidebarComponent,
    clipGridComponent,
    contextMenuComponent
  ].join('\n')

  for (const forbidden of [/from ['"`]electron['"`]/, /from ['"`]node:/, /\bipcRenderer\b/]) {
    assert.doesNotMatch(rendererSurface, forbidden)
  }

  for (const surface of [
    'ClipGrid',
    'ClipCard',
    'PreviewStage',
    'ContextMenu',
    'TagEditor',
    'onDragStart',
    'onDragClip',
    'Drag preview to timeline',
    'onDrop',
    'startClipDrag',
    'prepareClipDrag',
    'previewUrl',
    'rotationDegrees',
    'Bins',
    'Add Bin',
    'Remove from ClipDock',
    'Search filename, path, tags, notes',
    'Reveal in Explorer',
    'Copy Path'
  ]) {
    assert.match(rendererSurface, new RegExp(surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('packaging and README describe local-only installation, build, workflow, and limitations', () => {
  assert.match(builder, /node_modules\/ffmpeg-static/)
  assert.match(builder, /node_modules\/ffprobe-static/)
  assert.match(builder, /publish:\s*null/)

  for (const phrase of [
    'npm install',
    'npm run dev',
    'npm run build',
    'DaVinci Resolve',
    'Add Folder',
    'drag',
    'Known limitations',
    'Future roadmap',
    'No cloud',
    'No accounts',
    'No telemetry'
  ]) {
    assert.match(readme, new RegExp(phrase, 'i'))
  }
})

function compileRuntimeModules() {
  const scratchParent = join(projectRoot, 'tmp')

  mkdirSync(scratchParent, { recursive: true })

  const scratchRoot = mkdtempSync(join(scratchParent, 'clipdock-mvp-ts-'))
  const outDir = join(scratchRoot, 'compiled')
  const tsconfigFile = join(scratchRoot, 'tsconfig.mvp.json')
  const tscBin = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc')

  assert.ok(existsSync(tscBin), 'Run npm install before npm run test:mvp')
  writeFileSync(
    tsconfigFile,
    JSON.stringify(
      {
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
          join(projectRoot, 'src', 'main', 'libraryStore.ts'),
          join(projectRoot, 'src', 'main', 'rotatedExport.ts'),
          join(projectRoot, 'src', 'main', 'libraryScanner.ts'),
          join(projectRoot, 'src', 'main', 'mediaProbe.ts'),
          join(projectRoot, 'src', 'main', 'thumbnailer.ts'),
          join(projectRoot, 'src', 'shared', 'clipdock.ts')
        ]
      },
      null,
      2
    )
  )

  const result = spawnSync(process.execPath, [tscBin, '-p', tsconfigFile], {
    cwd: projectRoot,
    encoding: 'utf8'
  })

  assert.equal(
    result.status,
    0,
    `MVP temp TypeScript compile failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  )

  const requireFromCompiled = createRequire(join(outDir, 'src', 'main', 'libraryStore.js'))

  return {
    scratchRoot,
    storeModule: requireFromCompiled(join(outDir, 'src', 'main', 'libraryStore.js')),
    rotatedExportModule: requireFromCompiled(join(outDir, 'src', 'main', 'rotatedExport.js')),
    scannerModule: requireFromCompiled(join(outDir, 'src', 'main', 'libraryScanner.js'))
  }
}

function createIdGenerator() {
  let nextId = 0

  return () => `id-${String(++nextId).padStart(3, '0')}`
}

test('runtime scanner imports a real local video with metadata, thumbnail, tags, notes, and favorite state', async () => {
  const runtime = compileRuntimeModules()
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-mvp-runtime-'))
  const mediaDir = join(workspace, 'media')
  const thumbnailDir = join(workspace, 'thumbs')
  const databaseFile = join(workspace, 'db', 'library.sqlite')
  const managedDir = join(workspace, 'managed')
  const videoFile = join(mediaDir, 'sample.mp4')
  const requireFromProject = createRequire(join(projectRoot, 'package.json'))
  const ffmpegPath = requireFromProject('ffmpeg-static')
  let store

  try {
    mkdirSync(mediaDir, { recursive: true })
    mkdirSync(thumbnailDir, { recursive: true })
    mkdirSync(managedDir, { recursive: true })

    const videoResult = spawnSync(
      ffmpegPath,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=160x90:rate=24',
        '-t',
        '1',
        '-pix_fmt',
        'yuv420p',
        videoFile
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    )

    assert.equal(
      videoResult.status,
      0,
      `Fixture video generation failed\nSTDOUT:\n${videoResult.stdout}\nSTDERR:\n${videoResult.stderr}`
    )

    store = runtime.storeModule.openLibraryStore({
      databaseFile,
      libraryDir: managedDir,
      now: () => 1_800_000_000_000,
      createId: createIdGenerator()
    }).value

    const linked = store.createLinkedFolderRecord({ folder: mediaDir })

    assert.equal(linked.ok, true)

    const scan = await runtime.scannerModule.scanLibrary({
      store,
      thumbnailCacheDir: thumbnailDir,
      now: () => 1_800_000_000_000
    })

    assert.equal(scan.summary.totalFiles, 1)
    assert.equal(scan.summary.importedClips, 1)
    assert.equal(scan.snapshot.clips.length, 1)

    const clip = scan.snapshot.clips[0]

    assert.equal(clip.displayName, 'sample.mp4')
    assert.equal(clip.extension, '.mp4')
    assert.equal(clip.widthPixels, 160)
    assert.equal(clip.heightPixels, 90)
    assert.ok(clip.durationMs >= 900)
    assert.ok(clip.fps >= 23)
    assert.equal(typeof clip.codec, 'string')
    assert.ok(clip.thumbnailUrl.startsWith('clipdock-media://thumbnail/'))

    const thumbnailPath = store.getClipAsset(clip.id, 'thumbnail')

    assert.equal(thumbnailPath.ok, true)
    assert.ok(existsSync(thumbnailPath.value))

    const tagged = store.updateClipTags(clip.id, ['overlay', 'Resolve'])

    assert.equal(tagged.ok, true)
    assert.deepEqual(tagged.value.clips[0].tags, ['overlay', 'Resolve'])

    const noted = store.updateClipNote(clip.id, 'usable intro texture')

    assert.equal(noted.ok, true)
    assert.equal(noted.value.clips[0].note, 'usable intro texture')

    const favorited = store.toggleFavorite(clip.id)

    assert.equal(favorited.ok, true)
    assert.equal(favorited.value.clips[0].favorite, true)
    assert.equal(store.close().ok, true)
  } finally {
    try {
      store?.close()
    } catch {
      // Preserve the primary assertion failure, if any.
    }

    try {
      rmSync(workspace, { recursive: true, force: true })
    } catch {
      // SQLite can briefly hold a WAL handle on Windows after close.
    }

    rmSync(runtime.scratchRoot, { recursive: true, force: true })
  }
})

test('library store creates bins and assigns one clip to multiple bins', async () => {
  const runtime = compileRuntimeModules()
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-bins-runtime-'))
  const mediaDir = join(workspace, 'media')
  const managedDir = join(workspace, 'managed')
  const databaseFile = join(workspace, 'db', 'library.sqlite')
  const sourceFile = join(mediaDir, 'sample.mp4')
  const managedFile = join(managedDir, 'sample.mp4')
  let store

  try {
    mkdirSync(mediaDir, { recursive: true })
    mkdirSync(managedDir, { recursive: true })
    writeFileSync(sourceFile, 'store-only source video')
    writeFileSync(managedFile, 'store-only managed video')

    store = runtime.storeModule.openLibraryStore({
      databaseFile,
      libraryDir: managedDir,
      now: () => 1_800_000_000_000,
      createId: createIdGenerator()
    }).value

    const copied = store.createCopiedClipRecord({ sourceFile, managedFile })

    assert.equal(copied.ok, true)

    const clipId = copied.value.clip.id
    const first = store.createBin('B-Roll')
    const second = store.createBin('Social')

    assert.equal(first.ok, true)
    assert.equal(second.ok, true)

    const firstBinId = first.value.bins.find((bin) => bin.name === 'B-Roll').id
    const secondBinId = second.value.bins.find((bin) => bin.name === 'Social').id
    const assignedFirst = store.addClipsToBin([clipId], firstBinId)
    const assignedSecond = store.addClipsToBin([clipId], secondBinId)

    assert.equal(assignedFirst.ok, true)
    assert.equal(assignedSecond.ok, true)

    const snapshot = store.snapshot()

    assert.equal(snapshot.ok, true)
    const expectedBinIds = snapshot.value.bins.map((bin) => bin.id).sort()

    assert.deepEqual([...snapshot.value.clips[0].binIds].sort(), expectedBinIds)
    assert.equal(snapshot.value.bins[0].clipCount, 1)
    assert.equal(snapshot.value.bins[1].clipCount, 1)
    assert.equal(store.close().ok, true)
  } finally {
    try {
      store?.close()
    } catch {
      // Preserve the primary assertion failure, if any.
    }

    try {
      rmSync(workspace, { recursive: true, force: true })
    } catch {
      // Preserve the primary assertion failure, if any.
    }
  }
})

test('library store removes clips from ClipDock and stores valid rotations only', async () => {
  const runtime = compileRuntimeModules()
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-rotation-runtime-'))
  const mediaDir = join(workspace, 'media')
  const managedDir = join(workspace, 'managed')
  const databaseFile = join(workspace, 'db', 'library.sqlite')
  const sourceFile = join(mediaDir, 'sample.mp4')
  const managedFile = join(managedDir, 'sample.mp4')
  let store

  try {
    mkdirSync(mediaDir, { recursive: true })
    mkdirSync(managedDir, { recursive: true })
    writeFileSync(sourceFile, 'store-only source video')
    writeFileSync(managedFile, 'store-only managed video')

    store = runtime.storeModule.openLibraryStore({
      databaseFile,
      libraryDir: managedDir,
      now: () => 1_800_000_000_000,
      createId: createIdGenerator()
    }).value

    const copied = store.createCopiedClipRecord({ sourceFile, managedFile })

    assert.equal(copied.ok, true)

    const clipId = copied.value.clip.id
    const rotated = store.updateClipRotation(clipId, 90)

    assert.equal(rotated.ok, true)
    assert.equal(rotated.value.clips[0].rotationDegrees, 90)

    const invalid = store.updateClipRotation(clipId, 45)

    assert.equal(invalid.ok, false)
    assert.equal(invalid.error.code, 'LIBRARY_INVALID_INPUT')

    const removed = store.removeClipsFromLibrary([clipId])

    assert.equal(removed.ok, true)
    assert.equal(removed.value.clips.length, 0)
    assert.equal(existsSync(sourceFile), true)
    assert.equal(existsSync(managedFile), true)
    assert.equal(store.close().ok, true)
  } finally {
    try {
      store?.close()
    } catch {
      // Preserve the primary assertion failure, if any.
    }

    try {
      rmSync(workspace, { recursive: true, force: true })
    } catch {
      // Preserve the primary assertion failure, if any.
    }
  }
})

test('library store reuses and invalidates rotation export cache records by source freshness', async () => {
  const runtime = compileRuntimeModules()
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-export-cache-runtime-'))
  const mediaDir = join(workspace, 'media')
  const managedDir = join(workspace, 'managed')
  const exportDir = join(workspace, 'exports')
  const databaseFile = join(workspace, 'db', 'library.sqlite')
  const sourceFile = join(mediaDir, 'sample.mp4')
  const managedFile = join(managedDir, 'sample.mp4')
  const exportFile = join(exportDir, 'rot90.mp4')
  let store

  try {
    mkdirSync(mediaDir, { recursive: true })
    mkdirSync(managedDir, { recursive: true })
    mkdirSync(exportDir, { recursive: true })
    writeFileSync(sourceFile, 'store-only source video')
    writeFileSync(managedFile, 'store-only managed video')
    writeFileSync(exportFile, 'store-only rotated export')

    store = runtime.storeModule.openLibraryStore({
      databaseFile,
      libraryDir: managedDir,
      now: () => 1_800_000_000_000,
      createId: createIdGenerator()
    }).value

    const copied = store.createCopiedClipRecord({ sourceFile, managedFile })

    assert.equal(copied.ok, true)

    const clipId = copied.value.clip.id
    const saved = store.upsertClipRotationExport({
      clipId,
      rotationDegrees: 90,
      sourceSizeBytes: 24,
      sourceModifiedAtMs: 100,
      exportPath: exportFile
    })

    assert.equal(saved.ok, true)
    assert.equal(saved.value.exportPath, exportFile)

    const reused = store.getClipRotationExport({
      clipId,
      rotationDegrees: 90,
      sourceSizeBytes: 24,
      sourceModifiedAtMs: 100
    })

    assert.equal(reused.ok, true)
    assert.equal(reused.value.exportPath, exportFile)

    const stale = store.getClipRotationExport({
      clipId,
      rotationDegrees: 90,
      sourceSizeBytes: 25,
      sourceModifiedAtMs: 100
    })

    assert.equal(stale.ok, true)
    assert.equal(stale.value, null)
    assert.equal(store.close().ok, true)
  } finally {
    try {
      store?.close()
    } catch {
      // Preserve the primary assertion failure, if any.
    }

    try {
      rmSync(workspace, { recursive: true, force: true })
    } catch {
      // Preserve the primary assertion failure, if any.
    }
  }
})

test('rotated drag export resolver can fail fast instead of rendering during drag', async () => {
  const runtime = compileRuntimeModules()
  const workspace = mkdtempSync(join(tmpdir(), 'clipdock-drag-export-runtime-'))
  const mediaDir = join(workspace, 'media')
  const managedDir = join(workspace, 'managed')
  const exportDir = join(workspace, 'exports')
  const databaseFile = join(workspace, 'db', 'library.sqlite')
  const sourceFile = join(mediaDir, 'sample.mp4')
  const managedFile = join(managedDir, 'sample.mp4')
  const exportFile = join(exportDir, 'rot90-ready.mp4')
  let store

  try {
    mkdirSync(mediaDir, { recursive: true })
    mkdirSync(managedDir, { recursive: true })
    mkdirSync(exportDir, { recursive: true })
    writeFileSync(sourceFile, 'store-only source video')
    writeFileSync(managedFile, 'store-only managed video')

    store = runtime.storeModule.openLibraryStore({
      databaseFile,
      libraryDir: managedDir,
      now: () => 1_800_000_000_000,
      createId: createIdGenerator()
    }).value

    const copied = store.createCopiedClipRecord({ sourceFile, managedFile })

    assert.equal(copied.ok, true)

    const input = {
      store,
      clipId: copied.value.clip.id,
      sourcePath: managedFile,
      sourceSizeBytes: 24,
      sourceModifiedAtMs: 100,
      rotationDegrees: 90,
      exportCacheDir: exportDir,
      renderIfMissing: false
    }

    const notPrepared = await runtime.rotatedExportModule.resolveRotatedExportPath(input)

    assert.equal(notPrepared.ok, false)
    assert.equal(notPrepared.error.code, 'CLIP_EXPORT_FAILED')
    assert.match(notPrepared.error.message, /not ready/i)

    writeFileSync(exportFile, 'store-only corrupt rotated export')
    const corruptSaved = store.upsertClipRotationExport({
      clipId: copied.value.clip.id,
      rotationDegrees: 90,
      sourceSizeBytes: 24,
      sourceModifiedAtMs: 100,
      exportPath: exportFile
    })

    assert.equal(corruptSaved.ok, true)

    const corrupt = await runtime.rotatedExportModule.resolveRotatedExportPath(input)

    assert.equal(corrupt.ok, false)
    assert.equal(corrupt.error.code, 'CLIP_EXPORT_FAILED')
    assert.match(corrupt.error.message, /invalid/i)
    assert.equal(existsSync(exportFile), false)

    const requireFromProject = createRequire(join(projectRoot, 'package.json'))
    const ffmpegPath = requireFromProject('ffmpeg-static')
    const exportResult = spawnSync(
      ffmpegPath,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=64x36:rate=5',
        '-t',
        '0.2',
        '-pix_fmt',
        'yuv420p',
        exportFile
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    )

    assert.equal(
      exportResult.status,
      0,
      `Fixture export generation failed\nSTDOUT:\n${exportResult.stdout}\nSTDERR:\n${exportResult.stderr}`
    )

    const validSaved = store.upsertClipRotationExport({
      clipId: copied.value.clip.id,
      rotationDegrees: 90,
      sourceSizeBytes: 24,
      sourceModifiedAtMs: 100,
      exportPath: exportFile
    })

    assert.equal(validSaved.ok, true)

    const prepared = await runtime.rotatedExportModule.resolveRotatedExportPath(input)

    assert.equal(prepared.ok, true)
    assert.equal(prepared.value, exportFile)
    assert.equal(store.close().ok, true)
  } finally {
    try {
      store?.close()
    } catch {
      // Preserve the primary assertion failure, if any.
    }

    try {
      rmSync(workspace, { recursive: true, force: true })
    } catch {
      // Preserve the primary assertion failure, if any.
    }

    rmSync(runtime.scratchRoot, { recursive: true, force: true })
  }
})
