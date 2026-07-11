import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const requireFromMain = createRequire(__filename)
const ffmpegPath = requireFromMain('ffmpeg-static') as string | null
const MAX_ERROR_LENGTH = 64 * 1024

export async function runFfmpeg(args: string[], timeoutMs = 60_000): Promise<void> {
  if (!ffmpegPath) throw new Error('Bundled FFmpeg is unavailable.')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('FFmpeg operation timed out.'))
    }, timeoutMs)
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-MAX_ERROR_LENGTH)
    })
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      finish(code === 0 ? undefined : new Error(stderr.trim() || 'FFmpeg operation failed.'))
    })
  })
}
