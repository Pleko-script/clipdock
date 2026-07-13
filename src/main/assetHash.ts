import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export async function hashAssetFile(filePath: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new DOMException('Hashing was cancelled.', 'AbortError')

  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  const abort = (): void => {
    stream.destroy(new DOMException('Hashing was cancelled.', 'AbortError'))
  }
  signal?.addEventListener('abort', abort, { once: true })

  try {
    for await (const chunk of stream) hash.update(chunk)
    return hash.digest('hex')
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}
