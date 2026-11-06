// File storage for everything downloaded: episodes, manga and ranobe chapters, books.
// iPad: a folder the person picks in Files (it stays when the app is deleted); until one is picked, and
//   for files that were saved before, the app's own folder via Capacitor Filesystem.
// Android: the app's own folder. Windows (Electron) and browsers: the Origin Private File System.
// What lies where in the folder, and the rule that keeps old downloads readable: see library.ts.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { create } from 'zustand'
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

const asBase64 = (data: Uint8Array | string) => toBase64(typeof data === 'string' ? new TextEncoder().encode(data) : data)

export interface Store {
  write(path: string, data: Uint8Array | string): Promise<void>
  read(path: string): Promise<Uint8Array>
  /** removes a folder or a single file */
  removeDir(dir: string): Promise<void>
}

const capacitorStore: Store = {
  async write(path, data) {
    await Filesystem.writeFile({ path: `${ROOT}/${path}`, data: await asBase64(data), directory: Directory.Data, recursive: true })
  },
  async read(path) {
    const r = await Filesystem.readFile({ path: `${ROOT}/${path}`, directory: Directory.Data })
    return typeof r.data === 'string' ? fromBase64(r.data) : new Uint8Array(await r.data.arrayBuffer())
  },
  async removeDir(dir) {
    const at = { path: `${ROOT}/${dir}`, directory: Directory.Data }
    await Filesystem.rmdir({ ...at, recursive: true }).catch(() => Filesystem.deleteFile(at).catch(() => {}))
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

// --- the picked folder (iPad) -------------------------------------------------------------------------

interface FolderPlugin {
  pick(): Promise<{ name?: string }>
  restore(): Promise<{ name?: string; lost?: string }>
  forget(): Promise<void>
  write(o: { path: string; data: string }): Promise<void>
  read(o: { path: string }): Promise<{ data: string }>
  remove(o: { path: string }): Promise<void>
  list(o: { path: string }): Promise<{ names: string[] }>
  adopt(o: { from: string }): Promise<{ moved: number; left: number }>
  space(): Promise<{ free?: number }>
}

const Folder = registerPlugin<FolderPlugin>('AnyflowFolder')

/** only the iPad build carries the folder module */
export const folderSupported = Capacitor.getPlatform() === 'ios'

/** the picked folder's name; `lost`: one was picked before but can't be opened now (after a reinstall) */
export const useFolder = create<{ name: string | null; lost: string | null }>(() => ({ name: null, lost: null }))

const folderReady: Promise<void> = folderSupported
  ? Folder.restore()
      .then((r) => useFolder.setState({ name: r.name ?? null, lost: r.name ? null : (r.lost ?? null) }))
      .catch(() => {})
  : Promise.resolve()

/** resolves once it is known whether a folder is in use */
export const whenFolderKnown = () => folderReady
const inFolder = () => !!useFolder.getState().name

const folderStore: Store = {
  async write(path, data) {
    await Folder.write({ path, data: await asBase64(data) })
  },
  async read(path) {
    return fromBase64((await Folder.read({ path })).data)
  },
  async removeDir(dir) {
    await Folder.remove({ path: dir }).catch(() => {})
  },
}

// new files go to the folder; reading falls back to the app's own folder for what was saved before it
const iosStore: Store = {
  async write(path, data) {
    await folderReady
    return inFolder() ? folderStore.write(path, data) : capacitorStore.write(path, data)
  },
  async read(path) {
    await folderReady
    if (inFolder()) {
      try {
        return await folderStore.read(path)
      } catch {
        /* saved before the folder was picked */
      }
    }
    return capacitorStore.read(path)
  },
  async removeDir(dir) {
    await folderReady
    if (inFolder()) await folderStore.removeDir(dir)
    await capacitorStore.removeDir(dir)
  },
}

/** downloads: in the picked folder when there is one */
export const storage: Store = folderSupported ? iosStore : isNative ? capacitorStore : opfsStore
/** caches the app can always make again (thumbnails, translations): never in the person's folder */
export const cacheStorage: Store = isNative ? capacitorStore : opfsStore

/** shows the iPad folder picker; true once a folder is in use */
export async function pickFolder() {
  const r = await Folder.pick()
  if (!r.name) return false
  useFolder.setState({ name: r.name, lost: null })
  return true
}

/** moves what was downloaded into the app's own folder over to the picked one */
export const adoptOldDownloads = () => Folder.adopt({ from: ROOT }).catch(() => ({ moved: 0, left: 0 }))

export async function forgetFolder() {
  await Folder.forget().catch(() => {})
  useFolder.setState({ name: null, lost: null })
}

/** asks the browser not to evict downloads when the disk fills up */
export async function keepStorage() {
  if (!isNative) await navigator.storage?.persist?.().catch(() => false)
}

export async function freeSpace(): Promise<number | null> {
  if (folderSupported) {
    await folderReady
    return inFolder() ? ((await Folder.space().catch(() => ({ free: undefined }))).free ?? null) : null
  }
  if (isNative) return null
  const e = await navigator.storage?.estimate?.().catch(() => null)
  return e?.quota != null && e.usage != null ? e.quota - e.usage : null
}
