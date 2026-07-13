import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const projectRoot = process.cwd()
const ffmpegPath = join(
  projectRoot,
  'node_modules',
  'ffmpeg-static',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
)
const viewports = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 }
]

let app: ElectronApplication
let page: Page
let workspace: string

interface SeedAsset {
  id: string
  displayName: string
  filePath: string
  extension?: string
  kind?: 'transition' | 'sound' | 'overlay'
  mediaType?: 'video' | 'audio'
  compatibility?: 'expected' | 'unsupported'
  width?: number | null
  height?: number | null
  codec?: string | null
  audioCodec?: string | null
  channels?: number | null
  hasAlpha?: boolean
  status?: 'ready' | 'missing' | 'error'
  previewStatus?: 'ready' | 'pending' | 'failed'
  trimStartMs?: number | null
  trimEndMs?: number | null
  trimStatus?: 'none' | 'pending' | 'ready' | 'failed'
  thumbnailPath?: string | null
  previewPath?: string | null
  contentHash?: string | null
  duplicateHidden?: boolean
}

function generateVideo(filePath: string, width: number, height: number): void {
  const result = spawnSync(
    ffmpegPath,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${width}x${height}:rate=24`,
      '-t',
      '3',
      '-pix_fmt',
      'yuv420p',
      filePath
    ],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) throw new Error(result.stderr)
}

function generateAudio(filePath: string): void {
  const result = spawnSync(
    ffmpegPath,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:sample_rate=48000',
      '-t',
      '3',
      '-c:a',
      'pcm_s16le',
      filePath
    ],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) throw new Error(result.stderr)
}

function generateAudioArtwork(
  audioPath: string,
  waveformPath: string,
  spectrogramPath: string
): void {
  for (const [outputPath, filter] of [
    [waveformPath, 'aformat=channel_layouts=mono,showwavespic=s=640x360:colors=0xECECEA'],
    [
      spectrogramPath,
      'aformat=channel_layouts=mono,showspectrumpic=s=640x360:legend=disabled:color=fiery:scale=log'
    ]
  ]) {
    const result = spawnSync(
      ffmpegPath,
      ['-y', '-i', audioPath, '-filter_complex', filter, '-frames:v', '1', outputPath],
      { encoding: 'utf8' }
    )
    if (result.status !== 0) throw new Error(result.stderr)
  }
}

async function launch(profilePath: string): Promise<{ app: ElectronApplication; page: Page }> {
  const launched = await electron.launch({
    args: [projectRoot, `--user-data-dir=${profilePath}`]
  })
  const firstWindow = await launched.firstWindow()
  await firstWindow.waitForLoadState('domcontentloaded')
  return { app: launched, page: firstWindow }
}

function seedAssets(databaseFile: string, packRoot: string, assets: SeedAsset[]): void {
  const database = new DatabaseSync(databaseFile)
  const timestamp = Date.now()
  database
    .prepare(
      `INSERT INTO asset_packs
        (id, name, root_path, normalized_root_path, created_at_ms, updated_at_ms, last_scanned_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      'visual-pack',
      'Visual QA',
      packRoot,
      packRoot.toLocaleLowerCase('en-US'),
      timestamp,
      timestamp,
      timestamp
    )
  const insert = database.prepare(
    `INSERT INTO assets
      (id, pack_id, relative_path, category_path, display_name, file_path, normalized_file_path,
       extension, kind, media_type, overlay_mode, compatibility, size_bytes, modified_at_ms,
       duration_ms, width_pixels, height_pixels, fps, codec, audio_codec, channels,
       content_hash, hash_size_bytes, hash_modified_at_ms, duplicate_hidden, has_alpha,
       favorite, note, status, preview_status, trim_start_ms, trim_end_ms, rotation_degrees,
       trim_status, thumbnail_path, preview_path, created_at_ms, updated_at_ms)
     VALUES (?, 'visual-pack', ?, '', ?, ?, ?, ?, ?, ?, 'raw', ?, ?, ?, 3000, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       0, '', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  )
  for (const asset of assets) {
    const mediaType = asset.mediaType ?? 'video'
    insert.run(
      asset.id,
      asset.displayName,
      asset.displayName,
      asset.filePath,
      asset.filePath.toLocaleLowerCase('en-US'),
      asset.extension ?? (mediaType === 'audio' ? '.wav' : '.mp4'),
      asset.kind ?? (mediaType === 'audio' ? 'sound' : 'transition'),
      mediaType,
      asset.compatibility ?? 'expected',
      existsSync(asset.filePath) ? statSync(asset.filePath).size : 0,
      timestamp,
      asset.width ?? (mediaType === 'video' ? 640 : null),
      asset.height ?? (mediaType === 'video' ? 360 : null),
      mediaType === 'video' ? 24 : null,
      asset.codec ?? (mediaType === 'video' ? 'h264' : null),
      asset.audioCodec ?? (mediaType === 'audio' ? 'pcm_s16le' : null),
      asset.channels ?? (mediaType === 'audio' ? 1 : null),
      asset.contentHash ?? null,
      asset.contentHash ? (existsSync(asset.filePath) ? statSync(asset.filePath).size : 0) : null,
      asset.contentHash ? timestamp : null,
      asset.duplicateHidden ? 1 : 0,
      asset.hasAlpha ? 1 : 0,
      asset.status ?? 'ready',
      asset.previewStatus ?? 'ready',
      asset.trimStartMs ?? null,
      asset.trimEndMs ?? null,
      asset.trimStatus ?? 'none',
      asset.thumbnailPath ?? null,
      asset.previewPath ?? null,
      timestamp,
      timestamp
    )
  }
  database.close()
}

async function selectAsset(displayName: string): Promise<void> {
  const card = page.locator('.asset-card').filter({ hasText: displayName })
  await expect(card).toHaveCount(1)
  await card.click()
  await expect(page.locator('.asset-inspector > header strong')).toHaveText(displayName)
  await expect(page.locator('.trim-media-stage video')).toBeVisible()
}

test.beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'clipdock-visual-'))
  const profilePath = join(workspace, 'profile')
  const packRoot = join(workspace, 'pack')
  mkdirSync(profilePath, { recursive: true })
  mkdirSync(packRoot, { recursive: true })
  const landscape = join(packRoot, 'Landscape.mp4')
  const portrait = join(packRoot, 'Portrait.mp4')
  const landscapeCopy = join(packRoot, 'Landscape Copy.mp4')
  const alpha = join(packRoot, 'Alpha.mov')
  const preparing = join(packRoot, 'Preparing.mp4')
  const previewFailed = join(packRoot, 'Preview Failed.mp4')
  const failedEdit = join(packRoot, 'Failed Edit.mp4')
  const unsupported = join(packRoot, 'Unsupported.mp4')
  const sound = join(packRoot, 'Sound.wav')
  const waveform = join(packRoot, 'Sound-waveform.webp')
  const spectrogram = join(packRoot, 'Sound-spectrogram.webp')
  const missing = join(packRoot, 'Missing.mp4')
  generateVideo(landscape, 640, 360)
  copyFileSync(landscape, landscapeCopy)
  generateVideo(portrait, 360, 640)
  generateVideo(alpha, 640, 360)
  generateVideo(preparing, 640, 360)
  generateVideo(previewFailed, 640, 360)
  generateVideo(failedEdit, 640, 360)
  generateVideo(unsupported, 640, 360)
  generateAudio(sound)
  generateAudioArtwork(sound, waveform, spectrogram)

  const bootstrap = await launch(profilePath)
  await expect(bootstrap.page).toHaveTitle('ClipDock')
  await bootstrap.app.close()

  seedAssets(join(profilePath, 'clipdock-library', 'library.sqlite'), packRoot, [
    {
      id: 'visual-landscape',
      displayName: 'Landscape.mp4',
      filePath: landscape,
      contentHash: 'visual-exact-duplicate'
    },
    {
      id: 'visual-landscape-copy',
      displayName: 'Landscape Copy.mp4',
      filePath: landscapeCopy,
      contentHash: 'visual-exact-duplicate'
    },
    {
      id: 'visual-portrait',
      displayName: 'Portrait.mp4',
      filePath: portrait,
      width: 360,
      height: 640
    },
    {
      id: 'visual-alpha',
      displayName: 'Alpha.mov',
      filePath: alpha,
      extension: '.mov',
      kind: 'overlay',
      hasAlpha: true
    },
    {
      id: 'visual-preparing',
      displayName: 'Preparing.mp4',
      filePath: preparing,
      trimStartMs: 0,
      trimEndMs: 2_000,
      trimStatus: 'pending'
    },
    {
      id: 'visual-preview-failed',
      displayName: 'Preview Failed.mp4',
      filePath: previewFailed,
      previewStatus: 'failed'
    },
    {
      id: 'visual-edit-failed',
      displayName: 'Failed Edit.mp4',
      filePath: failedEdit,
      trimStartMs: 0,
      trimEndMs: 2_000,
      trimStatus: 'failed'
    },
    {
      id: 'visual-unsupported',
      displayName: 'Unsupported.mp4',
      filePath: unsupported,
      compatibility: 'unsupported'
    },
    {
      id: 'visual-sound',
      displayName: 'Whoosh Sound.wav',
      filePath: sound,
      mediaType: 'audio',
      kind: 'sound',
      thumbnailPath: waveform,
      previewPath: spectrogram
    },
    {
      id: 'visual-missing',
      displayName: 'Missing.mp4',
      filePath: missing,
      status: 'missing'
    }
  ])
  const running = await launch(profilePath)
  app = running.app
  page = running.page
  await expect(page.locator('.asset-card')).toHaveCount(10)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

test('empty library gives pack-import guidance', async () => {
  const blank = await launch(join(workspace, 'empty-profile'))
  try {
    await blank.page.setViewportSize(viewports[0])
    await expect(blank.page.locator('.asset-empty')).toBeVisible()
    await expect(blank.page.locator('.asset-empty button')).toHaveCount(0)
    await blank.page.screenshot({ path: test.info().outputPath('empty-1280x720.png') })
  } finally {
    await blank.app.close()
  }
})

test('panels resize, collapse independently, and persist', async () => {
  await page.setViewportSize(viewports[0])
  const organizeHandle = page.locator('.panel-resize-handle.organize')
  const organizeToggle = page.locator('.inspector-organize .inspector-panel-header button')
  const detailsToggle = page.locator('.inspector-file-panel .inspector-panel-header button')
  await expect(organizeHandle).toHaveAttribute('aria-valuenow', '220')
  await organizeHandle.press('ArrowRight')
  await expect(organizeHandle).toHaveAttribute('aria-valuenow', '228')

  await organizeToggle.click()
  await expect(organizeToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(detailsToggle).toHaveAttribute('aria-expanded', 'true')
  await page.reload()
  await expect(organizeToggle).toHaveAttribute('aria-expanded', 'false')
  await organizeToggle.click()
  await expect(page.locator('.panel-resize-handle.organize')).toHaveAttribute(
    'aria-valuenow',
    '228'
  )

  const detailsHandle = page.locator('.panel-resize-handle.details')
  await detailsHandle.press('ArrowRight')
  await expect(detailsHandle).toHaveAttribute('aria-valuenow', '212')
  await detailsToggle.click()
  await expect(detailsToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(organizeToggle).toHaveAttribute('aria-expanded', 'true')
  await detailsToggle.click()
  await expect(detailsHandle).toHaveAttribute('aria-valuenow', '212')
})

test('related SFX search can switch to exact mode in either language', async () => {
  await page.setViewportSize(viewports[0])
  const search = page.locator('.asset-search input')
  await search.fill('Wusch')
  const mode = page.locator('.search-mode')
  await expect(mode).toBeVisible()
  await expect(mode).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.asset-card').filter({ hasText: 'Whoosh Sound.wav' })).toBeVisible()

  await mode.click()
  await expect(mode).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.asset-empty')).toBeVisible()
  await mode.click()
  await expect(page.locator('.asset-card').filter({ hasText: 'Whoosh Sound.wav' })).toBeVisible()

  await page.locator('.sidebar-language button').filter({ hasText: 'EN' }).click()
  await expect(page.locator('.asset-card').filter({ hasText: 'Whoosh Sound.wav' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('related-search-1280x720.png') })
  await page.locator('.sidebar-language button').filter({ hasText: 'DE' }).click()
  await search.fill('')
})

test('temporary comparison tray orders, auditions, limits, collapses, and clears', async () => {
  await page.setViewportSize(viewports[0])
  const tray = page.locator('.comparison-tray')
  const add = async (name: string): Promise<void> => {
    if ((await tray.count()) && !(await tray.getAttribute('class'))?.includes('collapsed'))
      await tray.locator('header button').last().click()
    const card = page.locator('.asset-card').filter({ hasText: name })
    await card.scrollIntoViewIfNeeded()
    await card.hover({ force: true })
    await card.locator('.compare-icon').click({ force: true })
  }

  await add('Whoosh Sound.wav')
  await add('Landscape.mp4')
  await expect(tray).toBeVisible()
  await expect(tray.locator('.comparison-count')).toHaveText('2 / 6')
  await expect(tray.locator('.comparison-candidates strong')).toHaveText([
    'Whoosh Sound.wav',
    'Landscape.mp4'
  ])

  await tray
    .locator('.comparison-candidates > div')
    .filter({ hasText: 'Whoosh Sound.wav' })
    .locator('button')
    .first()
    .click()
  await expect(tray.locator('.comparison-media audio')).toHaveCount(1)
  await tray.locator('.comparison-transport button').nth(1).click()
  await expect.poll(() => tray.locator('audio').evaluate((audio) => !audio.paused)).toBe(true)

  await tray.locator('.comparison-transport button').first().click()
  await expect(tray.locator('.comparison-media video')).toHaveCount(1)
  await expect.poll(() => tray.locator('video').evaluate((video) => !video.paused)).toBe(true)
  await tray.focus()
  await tray.press('ArrowRight')
  await expect(tray.locator('.comparison-media audio')).toHaveCount(1)

  const gridHeight = await page.locator('.asset-grid-scroll').evaluate((grid) => grid.clientHeight)
  await tray.locator('header button').last().click()
  await expect(tray).toHaveClass(/collapsed/)
  await expect(tray.locator('audio, video')).toHaveCount(0)
  expect(await page.locator('.asset-grid-scroll').evaluate((grid) => grid.clientHeight)).toBe(
    gridHeight
  )
  await tray.locator('header button').last().click()

  await tray
    .locator('.comparison-candidates > div')
    .filter({ hasText: 'Landscape.mp4' })
    .locator('button')
    .last()
    .click()
  for (const name of [
    'Alpha.mov',
    'Failed Edit.mp4',
    'Missing.mp4',
    'Portrait.mp4',
    'Preparing.mp4'
  ])
    await add(name)
  await expect(tray.locator('.comparison-count')).toHaveText('6 / 6')
  const rejected = page.locator('.asset-card').filter({ hasText: 'Preview Failed.mp4' })
  await rejected.scrollIntoViewIfNeeded()
  await expect(rejected.locator('.compare-icon')).toBeDisabled()

  await page.screenshot({ path: test.info().outputPath('comparison-tray-1280x720.png') })
  await tray.locator('header button').first().click()
  await expect(tray).toHaveCount(0)

  const alpha = page.locator('.asset-card').filter({ hasText: 'Alpha.mov' })
  const portrait = page.locator('.asset-card').filter({ hasText: 'Portrait.mp4' })
  await alpha.click()
  await portrait.click({ modifiers: ['Control'] })
  await expect(page.locator('.asset-results-bar strong')).toContainText('2')
})

test('exact duplicate review shows sources and only hides database results', async () => {
  await page.setViewportSize(viewports[0])
  await page.locator('.sidebar-nav button').filter({ hasText: 'Duplikate' }).click()
  const group = page.locator('.duplicate-group')
  await expect(group).toHaveCount(1)
  await expect(group.locator('article')).toHaveCount(2)
  await expect(group).toContainText('Landscape.mp4')
  await expect(group).toContainText('Landscape Copy.mp4')
  await expect(
    group.locator('article').filter({ hasText: 'Landscape.mp4' }).locator('code')
  ).toContainText('Landscape.mp4')

  const copy = group.locator('article').filter({ hasText: 'Landscape Copy.mp4' })
  await copy.locator('button').last().click()
  await expect(copy).toHaveClass(/hidden-copy/)
  await page.locator('.sidebar-nav button').filter({ hasText: 'Alle Assets' }).click()
  await expect(page.locator('.asset-card')).toHaveCount(9)

  await page.locator('.sidebar-nav button').filter({ hasText: 'Duplikate' }).click()
  await group
    .locator('article')
    .filter({ hasText: 'Landscape Copy.mp4' })
    .locator('button')
    .last()
    .click()
  await page.locator('.sidebar-nav button').filter({ hasText: 'Alle Assets' }).click()
  await expect(page.locator('.asset-card')).toHaveCount(10)
  await page.locator('.sidebar-nav button').filter({ hasText: 'Duplikate' }).click()
  await page.screenshot({ path: test.info().outputPath('duplicates-1280x720.png') })
  await page.locator('.sidebar-nav button').filter({ hasText: 'Alle Assets' }).click()
  await page.getByLabel('Video-Editor ein-/ausblenden').click()
})

test('portrait and landscape media remain contained at target resolutions', async () => {
  const testInfo = test.info()
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    for (const displayName of ['Landscape.mp4', 'Portrait.mp4']) {
      await selectAsset(displayName)
      const layout = await page.locator('.asset-inspector').evaluate((inspector) => {
        const stage = inspector.querySelector('.trim-media-stage')
        const video = inspector.querySelector('.trim-media-stage video')
        const controls = [...inspector.querySelectorAll('button, input, select')]
        const inspectorBounds = inspector.getBoundingClientRect()
        return {
          overflowY: getComputedStyle(inspector).overflowY,
          stageWidth: stage?.getBoundingClientRect().width ?? 0,
          videoFit: video ? getComputedStyle(video).objectFit : '',
          controlsClipped: controls.some((control) => {
            const bounds = control.getBoundingClientRect()
            return (
              bounds.bottom > inspectorBounds.bottom + 1 || bounds.top < inspectorBounds.top - 1
            )
          })
        }
      })
      expect(layout.overflowY).toBe('hidden')
      expect(layout.videoFit).toBe('contain')
      expect(layout.stageWidth).toBeGreaterThan(175)
      expect(layout.controlsClipped).toBe(false)
      await page.screenshot({
        path: testInfo.outputPath(
          `${displayName.replace('.mp4', '').toLowerCase()}-${viewport.width}x${viewport.height}.png`
        )
      })
    }
  }
})

test('audio waveform scrubs, loops, switches view, and owns playback', async () => {
  await page.setViewportSize(viewports[0])
  const card = page.locator('.asset-card').filter({ hasText: 'Whoosh Sound.wav' })
  await card.scrollIntoViewIfNeeded()
  await card.click()

  const editor = page.locator('.asset-inspector .audio-preview-editor')
  const slider = editor.locator('.audio-waveform')
  await expect(editor).toBeVisible()
  await expect(slider.locator('img')).toHaveAttribute('src', /\/thumbnail\//)

  const bounds = await slider.boundingBox()
  expect(bounds).not.toBeNull()
  await slider.click({ position: { x: bounds!.width * 0.25, y: bounds!.height / 2 } })
  await expect
    .poll(async () => Number(await slider.getAttribute('aria-valuenow')))
    .toBeGreaterThan(650)
  await slider.press('i')
  await slider.click({ position: { x: bounds!.width * 0.75, y: bounds!.height / 2 } })
  await slider.press('o')
  await editor.locator('[aria-keyshortcuts="L"]').click()
  await expect(editor.locator('[aria-keyshortcuts="L"]')).toHaveAttribute('aria-pressed', 'true')

  const volume = editor.locator('input[type="range"]')
  await volume.fill('0.4')
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('clipdock.previewVolume')))
    .toBe('0.4')

  await editor.locator('header button').nth(1).click()
  await expect(slider.locator('img')).toHaveAttribute('src', /\/preview\//)
  const layout = await editor.evaluate((element) => {
    const inspectorBounds = element.closest('.asset-inspector')?.getBoundingClientRect()
    const bounds = element.getBoundingClientRect()
    return {
      withinInspector:
        Boolean(inspectorBounds) &&
        bounds.top >= inspectorBounds!.top &&
        bounds.bottom <= inspectorBounds!.bottom
    }
  })
  expect(layout.withinInspector).toBe(true)

  await editor.locator('.audio-transport > button').first().click()
  await expect.poll(() => editor.locator('audio').evaluate((audio) => !audio.paused)).toBe(true)
  await card.dblclick()
  const quickLook = page.locator('.quick-look .audio-preview-editor')
  await expect(quickLook).toBeVisible()
  await expect.poll(() => editor.locator('audio').evaluate((audio) => audio.paused)).toBe(true)
  await expect.poll(() => quickLook.locator('audio').evaluate((audio) => !audio.paused)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('audio-spectrogram-1280x720.png') })
  await page.keyboard.press('Escape')
})

test('actionable card and filtered-empty states expose recovery', async () => {
  await page.setViewportSize(viewports[0])
  const search = page.locator('.asset-search input')
  const states = [
    { query: 'Preparing.mp4', selector: '.readiness.derivative-preparing', name: 'preparing' },
    { query: 'Missing.mp4', selector: '.asset-recovery button', name: 'missing' },
    { query: 'Preview Failed.mp4', selector: '.asset-recovery button', name: 'preview-failed' },
    { query: 'Failed Edit.mp4', selector: '.readiness.failed', name: 'failed' },
    { query: 'Unsupported.mp4', selector: '.readiness.unsupported', name: 'unsupported' },
    { query: 'Alpha.mov', selector: '.asset-card-signals', name: 'alpha' },
    { query: 'Whoosh Sound.wav', selector: '.asset-card-signals', name: 'audio' }
  ]
  for (const state of states) {
    const card = page.locator('.asset-card').filter({ hasText: state.query })
    await expect(card).toHaveCount(1)
    await expect(card.locator(state.selector)).toBeVisible()
    await card.screenshot({ path: test.info().outputPath(`${state.name}-card.png`) })
  }

  await search.fill('definitely no matching asset')
  await expect(page.locator('.asset-empty button')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('filtered-empty-1280x720.png') })
  await page.locator('.asset-empty button').click()
  await expect(page.locator('.asset-card')).toHaveCount(10)
})
