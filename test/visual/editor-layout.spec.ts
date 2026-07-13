import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs'
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

async function launch(profilePath: string): Promise<{ app: ElectronApplication; page: Page }> {
  const launched = await electron.launch({
    args: [projectRoot, `--user-data-dir=${profilePath}`]
  })
  const firstWindow = await launched.firstWindow()
  await firstWindow.waitForLoadState('domcontentloaded')
  return { app: launched, page: firstWindow }
}

function seedAssets(databaseFile: string, packRoot: string, files: string[]): void {
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
       duration_ms, width_pixels, height_pixels, fps, codec, has_alpha, favorite, note, status,
       preview_status, rotation_degrees, trim_status, created_at_ms, updated_at_ms)
     VALUES (?, 'visual-pack', ?, '', ?, ?, ?, '.mp4', 'transition', 'video', 'raw', 'expected',
       ?, ?, 3000, ?, ?, 24, 'h264', 0, 0, '', 'ready', 'ready', 0, 'none', ?, ?)`
  )
  for (const [index, filePath] of files.entries()) {
    const portrait = filePath.endsWith('Portrait.mp4')
    const displayName = portrait ? 'Portrait.mp4' : 'Landscape.mp4'
    insert.run(
      `visual-${index}`,
      displayName,
      displayName,
      filePath,
      filePath.toLocaleLowerCase('en-US'),
      statSync(filePath).size,
      timestamp,
      portrait ? 360 : 640,
      portrait ? 640 : 360,
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
  generateVideo(landscape, 640, 360)
  generateVideo(portrait, 360, 640)

  const bootstrap = await launch(profilePath)
  await expect(bootstrap.page).toHaveTitle('ClipDock')
  await bootstrap.app.close()

  seedAssets(join(profilePath, 'clipdock-library', 'library.sqlite'), packRoot, [
    landscape,
    portrait
  ])
  const running = await launch(profilePath)
  app = running.app
  page = running.page
  await expect(page.locator('.asset-card')).toHaveCount(2)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
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
