import { watch } from 'node:fs'
import type { AssetPackSummary } from '../shared/clipdock'

export type WatchReconcileStatus = 'complete' | 'busy' | 'unavailable'

interface WatchHandle {
  close: () => void
  on: {
    (event: 'error', listener: (error: Error) => void): WatchHandle
    (event: 'close', listener: () => void): WatchHandle
  }
}

type WatchFactory = (
  rootPath: string,
  listener: (eventType: string, fileName: string | Buffer | null) => void
) => WatchHandle

interface PackWatchEntry {
  pack: AssetPackSummary
  watcher: WatchHandle | null
  changedPaths: Set<string>
  fullReconcile: boolean
  debounceTimer: ReturnType<typeof setTimeout> | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  running: boolean
}

export interface AssetPackWatcher {
  sync: (packs: AssetPackSummary[]) => void
  dispose: () => void
}

export interface AssetPackWatcherOptions {
  debounceMs?: number
  reconnectMs?: number
  watchFactory?: WatchFactory
}

const defaultWatchFactory: WatchFactory = (rootPath, listener) =>
  watch(rootPath, { recursive: true, persistent: false }, listener)

export function createAssetPackWatcher(
  reconcile: (
    pack: AssetPackSummary,
    changedPaths: string[] | null
  ) => Promise<WatchReconcileStatus>,
  options: AssetPackWatcherOptions = {}
): AssetPackWatcher {
  const debounceMs = Math.max(10, options.debounceMs ?? 600)
  const reconnectMs = Math.max(10, options.reconnectMs ?? 15_000)
  const watchFactory = options.watchFactory ?? defaultWatchFactory
  const entries = new Map<string, PackWatchEntry>()
  let disposed = false

  const clearTimer = (timer: ReturnType<typeof setTimeout> | null): void => {
    if (timer) clearTimeout(timer)
  }

  const closeWatcher = (entry: PackWatchEntry): void => {
    const watcher = entry.watcher
    entry.watcher = null
    if (watcher) watcher.close()
  }

  const queue = (entry: PackWatchEntry, changedPaths: string[] | null): void => {
    if (disposed || !entries.has(entry.pack.id)) return
    if (changedPaths === null) entry.fullReconcile = true
    else
      for (const changedPath of changedPaths) if (changedPath) entry.changedPaths.add(changedPath)
    clearTimer(entry.debounceTimer)
    entry.debounceTimer = setTimeout(() => void flush(entry), debounceMs)
  }

  const scheduleReconnect = (entry: PackWatchEntry): void => {
    if (disposed || entry.reconnectTimer || !entries.has(entry.pack.id)) return
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null
      start(entry, true)
    }, reconnectMs)
  }

  const disconnect = (entry: PackWatchEntry, watcher: WatchHandle | null): void => {
    if (watcher && entry.watcher !== watcher) return
    closeWatcher(entry)
    scheduleReconnect(entry)
  }

  const start = (entry: PackWatchEntry, reconnecting: boolean): void => {
    if (disposed || !entries.has(entry.pack.id)) return
    closeWatcher(entry)
    try {
      const watcher = watchFactory(entry.pack.rootPath, (_eventType, fileName) => {
        queue(entry, fileName === null ? null : [String(fileName)])
      })
      entry.watcher = watcher
      watcher.on('error', () => disconnect(entry, watcher))
      watcher.on('close', () => disconnect(entry, watcher))
      if (reconnecting) queue(entry, null)
    } catch {
      scheduleReconnect(entry)
    }
  }

  const flush = async (entry: PackWatchEntry): Promise<void> => {
    entry.debounceTimer = null
    if (disposed || !entries.has(entry.pack.id)) return
    if (entry.running) {
      queue(entry, entry.fullReconcile ? null : [...entry.changedPaths])
      return
    }
    const changedPaths = entry.fullReconcile ? null : [...entry.changedPaths]
    entry.fullReconcile = false
    entry.changedPaths.clear()
    if (changedPaths !== null && changedPaths.length === 0) return
    entry.running = true
    try {
      const status = await reconcile(entry.pack, changedPaths)
      if (status === 'busy') queue(entry, changedPaths)
      if (status === 'unavailable') disconnect(entry, entry.watcher)
    } catch {
      disconnect(entry, entry.watcher)
    } finally {
      entry.running = false
      if (entry.fullReconcile || entry.changedPaths.size) queue(entry, [])
    }
  }

  const remove = (entry: PackWatchEntry): void => {
    entries.delete(entry.pack.id)
    clearTimer(entry.debounceTimer)
    clearTimer(entry.reconnectTimer)
    closeWatcher(entry)
  }

  return {
    sync(packs): void {
      if (disposed) return
      const incoming = new Set(packs.map((pack) => pack.id))
      for (const entry of entries.values()) if (!incoming.has(entry.pack.id)) remove(entry)
      for (const pack of packs) {
        const existing = entries.get(pack.id)
        if (existing && existing.pack.rootPath === pack.rootPath) {
          existing.pack = pack
          continue
        }
        if (existing) remove(existing)
        const entry: PackWatchEntry = {
          pack,
          watcher: null,
          changedPaths: new Set(),
          fullReconcile: false,
          debounceTimer: null,
          reconnectTimer: null,
          running: false
        }
        entries.set(pack.id, entry)
        start(entry, false)
      }
    },
    dispose(): void {
      disposed = true
      for (const entry of [...entries.values()]) remove(entry)
    }
  }
}
