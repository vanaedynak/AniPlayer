// File storage for downloaded episodes.
// iPad / Android: the app's own folder via Capacitor Filesystem (survives updates, not evicted).
// Windows (Electron) and browsers: the Origin Private File System, a sandboxed folder on disk.
import { Filesystem, Directory } from '@capacitor/filesystem'
import { isNative } from './platform'

const ROOT = 'downloads'

function toBase64(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(new Blob([bytes as BlobPart]))
  })
}

async function fromBase64(b64: string) {
  return new Uint8Array(await (await fetch(`data:application/octet-stream;base64,${b64}`)).arrayBuffer())
}

interface Store {
  write(path: string, data: Uint8Array | string): Promise<void>
  read(path: string): Promise<Uint8Array>
  removeDir(dir: string): Promise<void>
}

const capacitorStore: Store = {
  async write(path, data) {
    await Filesystem.writeFile({
      path: `${ROOT}/${path}`,
      data: typeof data === 'string' ? await toBase64(new TextEncoder().encode(data)) : await toBase64(data),
      directory: Directory.Data,
      recursive: true,
    })
  },
  async read(path) {
    const r = await Filesystem.readFile({ path: `${ROOT}/${path}`, directory: Directory.Data })
    return typeof r.data === 'string' ? fromBase64(r.data) : new Uint8Array(await r.data.arrayBuffer())
  },
  async removeDir(dir) {
    await Filesystem.rmdir({ path: `${ROOT}/${dir}`, directory: Directory.Data, recursive: true }).catch(() => {})
  },
}

async function opfsDir(parts: string[], create: boolean) {
  let d = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true })
  for (const p of parts) d = await d.getDirectoryHandle(p, { create })
  return d
}

const opfsStore: Store = {
  async write(path, data) {
    const parts = path.split('/')
    const name = parts.pop()!
    const dir = await opfsDir(parts, true)
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
    await w.write(data as FileSystemWriteChunkType)
    await w.close()
  },
  async read(path) {
    const parts = path.split('/')
    const name = parts.pop()!
    const dir = await opfsDir(parts, false)
    return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer())
  },
  async removeDir(dir) {
    const root = await opfsDir([], true)
    await root.removeEntry(dir, { recursive: true }).catch(() => {})
  },
}

export const storage: Store = isNative ? capacitorStore : opfsStore

/** asks the browser not to evict downloads when the disk fills up */
export async function keepStorage() {
  if (!isNative) await navigator.storage?.persist?.().catch(() => false)
}

export async function freeSpace(): Promise<number | null> {
  if (isNative) return null
  const e = await navigator.storage?.estimate?.().catch(() => null)
  return e?.quota != null && e.usage != null ? e.quota - e.usage : null
}
