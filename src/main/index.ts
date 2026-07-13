import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import icon from '../../resources/icon.png?asset'
import { registerAssetIpc, type AssetIpcRegistration } from './assetIpc'

let assetIpc: AssetIpcRegistration | null = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'clipdock-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const mediaTypes: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mxf': 'application/mxf'
}

function externalUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function isSameNavigation(targetUrl: string, appUrl: string): boolean {
  try {
    return new URL(targetUrl).toString() === appUrl
  } catch {
    return false
  }
}

function parseAssetRequest(rawUrl: string): {
  kind: 'thumbnail' | 'preview' | 'media' | 'poster'
  assetId: string
} | null {
  try {
    const url = new URL(rawUrl)
    const kind =
      url.host === 'thumbnail' ||
      url.host === 'preview' ||
      url.host === 'media' ||
      url.host === 'poster'
        ? url.host
        : null
    const assetId = decodeURIComponent(url.pathname.slice(1))
    return kind && assetId && assetId.length <= 128 ? { kind, assetId } : null
  } catch {
    return null
  }
}

function registerMediaProtocol(): void {
  protocol.handle('clipdock-media', async (request) => {
    if (!assetIpc) return new Response('ClipDock is not ready.', { status: 503 })

    const parsed = parseAssetRequest(request.url)
    if (!parsed) return new Response('Unsupported asset URL.', { status: 404 })

    const resolved = assetIpc.resolveAssetPath(parsed.assetId, parsed.kind)
    if (!resolved.ok) return new Response(resolved.error.message, { status: 404 })

    try {
      if (!(await stat(resolved.value)).isFile()) {
        return new Response('Asset is not a file.', { status: 404 })
      }
    } catch {
      return new Response('Asset is missing.', { status: 404 })
    }

    const response = await net.fetch(pathToFileURL(resolved.value).toString(), {
      headers: request.headers
    })
    const headers = new Headers(response.headers)
    headers.set(
      'content-type',
      mediaTypes[extname(resolved.value).toLowerCase()] ?? 'application/octet-stream'
    )
    headers.set(
      'cache-control',
      parsed.kind === 'media' ? 'no-store' : 'public, max-age=31536000, immutable'
    )
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  })
}

function createWindow(): void {
  const rendererUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const rendererIndex = join(__dirname, '../renderer/index.html')
  const appUrl = rendererUrl
    ? new URL(rendererUrl).toString()
    : pathToFileURL(rendererIndex).toString()
  const window = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 900,
    minHeight: 600,
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

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    const allowed = externalUrl(url)
    if (allowed)
      void shell.openExternal(allowed).catch((error) => console.error('External URL failed', error))
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isSameNavigation(url, appUrl)) event.preventDefault()
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[clipdock] renderer process gone', details)
  })
  window.on('unresponsive', () => console.error('[clipdock] main window became unresponsive'))

  if (rendererUrl) void window.loadURL(appUrl)
  else void window.loadFile(rendererIndex)
}

app
  .whenReady()
  .then(() => {
    electronApp.setAppUserModelId('app.clipdock.desktop')
    app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))
    assetIpc = registerAssetIpc()
    registerMediaProtocol()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error) => {
    console.error('[clipdock] startup failed', error)
    app.quit()
  })

app.on('before-quit', () => {
  assetIpc?.dispose()
  assetIpc = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
