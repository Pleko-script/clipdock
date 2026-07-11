import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { stat } from 'node:fs/promises'
import { join } from 'path'
import { extname } from 'node:path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerAssetIpc, type AssetIpcRegistration } from './assetIpc'
import { registerLibraryIpc, type LibraryIpcRegistration } from './libraryIpc'

let libraryIpc: LibraryIpcRegistration | null = null
let assetIpc: AssetIpcRegistration | null = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'clipdock-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

function getAllowedExternalUrl(rawUrl: string): string | null {
  try {
    const parsedUrl = new URL(rawUrl)

    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      return parsedUrl.toString()
    }
  } catch {
    return null
  }

  return null
}

function normalizeAppUrl(rawUrl: string): string {
  return new URL(rawUrl).toString()
}

function isAllowedAppNavigation(targetUrl: string, allowedAppUrl: string): boolean {
  try {
    return new URL(targetUrl).toString() === allowedAppUrl
  } catch {
    return false
  }
}

function contentTypeForPath(filePath: string): string {
  const extension = extname(filePath).toLocaleLowerCase('en-US')

  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.wav') return 'audio/wav'
  if (extension === '.mp3') return 'audio/mpeg'
  if (extension === '.aac') return 'audio/aac'
  if (extension === '.m4a') return 'audio/mp4'
  if (extension === '.flac') return 'audio/flac'
  if (extension === '.ogg') return 'audio/ogg'
  if (extension === '.webm') return 'video/webm'
  if (extension === '.mov') return 'video/quicktime'
  if (extension === '.mkv') return 'video/x-matroska'

  return 'video/mp4'
}

function registerAssetProtocol(): void {
  protocol.handle('clipdock-media', async (request) => {
    if (!libraryIpc || !assetIpc) {
      return new Response('ClipDock library is not ready.', { status: 503 })
    }

    const requestUrl = new URL(request.url)
    const kind =
      requestUrl.host === 'thumbnail' ||
      requestUrl.host === 'preview' ||
      requestUrl.host === 'media'
        ? requestUrl.host
        : requestUrl.host === 'clip'
          ? 'media'
          : null
    const assetId = decodeURIComponent(requestUrl.pathname.replace(/^\//, ''))

    if (!kind || assetId.length === 0) {
      return new Response('Unsupported ClipDock asset URL.', { status: 404 })
    }

    const asset = assetIpc.resolveAssetPath(assetId, kind)
    const legacyAsset =
      !asset.ok && kind !== 'preview'
        ? libraryIpc.resolveAssetPath(assetId, kind === 'thumbnail' ? 'thumbnail' : 'media')
        : asset

    if (!legacyAsset.ok) {
      return new Response(legacyAsset.error.message, { status: 404 })
    }

    try {
      const stats = await stat(legacyAsset.value)

      if (!stats.isFile()) {
        return new Response('ClipDock asset is not a file.', { status: 404 })
      }
    } catch {
      return new Response('ClipDock asset is missing.', { status: 404 })
    }

    const response = await net.fetch(pathToFileURL(legacyAsset.value).toString())

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'content-type': contentTypeForPath(legacyAsset.value),
        'cache-control': kind === 'thumbnail' ? 'public, max-age=31536000' : 'no-store'
      }
    })
  })
}

function createWindow(): void {
  const rendererUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const rendererIndexPath = join(__dirname, '../renderer/index.html')
  const appUrl = rendererUrl
    ? normalizeAppUrl(rendererUrl)
    : pathToFileURL(rendererIndexPath).toString()

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 820,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = getAllowedExternalUrl(url)

    if (externalUrl) {
      void shell.openExternal(externalUrl).catch((error) => {
        console.error('Failed to open external URL', error)
      })
    }

    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppNavigation(url, appUrl)) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[clipdock] renderer process gone:', details)
  })

  mainWindow.on('unresponsive', () => {
    console.error('[clipdock] main window became unresponsive')
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (rendererUrl) {
    mainWindow.loadURL(appUrl)
  } else {
    mainWindow.loadFile(rendererIndexPath)
  }
}

process.on('uncaughtException', (error) => {
  console.error('[clipdock] uncaughtException:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[clipdock] unhandledRejection:', reason)
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  libraryIpc = registerLibraryIpc()
  assetIpc = registerAssetIpc()
  registerAssetProtocol()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  assetIpc?.dispose()
  assetIpc = null
  libraryIpc?.dispose()
  libraryIpc = null
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
