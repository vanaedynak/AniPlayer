// Chapters saved for reading without the internet, manga and ranobe alike. Manga keeps every page image,
// ranobe the chapter's text; next to them, the title's own data (its chapter list), so the title opens
// offline too. Files live in the same device storage as downloaded episodes.
// Each chapter is one archive, and only the chapter being read is opened: a manga chapter is a .cbz
// (the comic-book zip any comic reader opens: pages 001.jpg, 002.png… stored as they came), a ranobe
// chapter a .zip with text.html, compressed. Chapters saved before this were loose files in a folder;
// they still open, and are packed the first time they are read.
import { create } from 'zustand'
import { unzipSync, zipSync, type Zippable } from 'fflate'
import { persist } from 'zustand/middleware'
import { CapacitorHttp } from '@capacitor/core'
import { storage, keepStorage } from '../lib/offline'
import { onPowerSaving, powerSaving } from '../lib/power'
import { isNative } from '../lib/platform'
import type { Chapter, Manga } from './md'
import type { Novel } from '../ranobe/sources'
import { mdBytes, viaNative } from './mdImage'

export type SaveStatus = 'queued' | 'saving' | 'done' | 'error'

export interface SavedChapter {
  key: string
  kind: 'manga' | 'novel'
  /** the shelf id: a MangaDex id, or "ln-<source>-<novel>" */
  entry: string
  chapterId: string
  label: string
  /** place in the title's reading order */
  order: number
  status: SaveStatus
  done: number
  total: number
  bytes: number
  error?: string
  addedAt: number
  /** manga: the chapter as the reader knows it, for opening it with no chapter list at hand */
  chapter?: Chapter
}

export interface SavedTitle {
  entry: string
  kind: 'manga' | 'novel'
  title: string
  cover: string
  /** ranobe: where it came from */
  src?: string
  novelId?: string
}

interface SavedState {
  items: Record<string, SavedChapter>
  titles: Record<string, SavedTitle>
  saveManga: (m: Manga, chapters: Chapter[], order: (c: Chapter) => number) => void
  saveNovel: (src: string, n: Novel, ids: string[]) => void
  remove: (key: string) => Promise<void>
  removeTitle: (entry: string) => Promise<void>
  retry: (key: string) => void
  patch: (key: string, p: Partial<SavedChapter>) => void
}

const safe = (s: string) => s.replace(/[^a-z0-9-]/gi, '_').slice(0, 100)
export const savedKey = (entry: string, chapterId: string) => `${entry}|${chapterId}`
const dirOf = (it: Pick<SavedChapter, 'entry' | 'chapterId'>) => `ch-${safe(it.entry)}-${safe(it.chapterId)}`
const metaFile = (entry: string) => `chm-${safe(entry)}/meta.json`
/** the chapter's archive: format 1, see the header and library.ts */
const archiveOf = (it: Pick<SavedChapter, 'entry' | 'chapterId' | 'kind'>) => `${dirOf(it)}.${it.kind === 'manga' ? 'cbz' : 'zip'}`
const TEXT = 'text.html'

/** a page's file type from its first bytes, for the name inside the archive */
function ext(b: Uint8Array) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg'
  if (b[0] === 0x89 && b[1] === 0x50) return 'png'
  if (b[0] === 0x47 && b[1] === 0x49) return 'gif'
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'avif'
  return 'jpg'
}
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' }

/** pages are already compressed pictures: stored as they are, which also keeps opening one cheap */
const packPages = (pages: Uint8Array[]) => zipSync(Object.fromEntries(pages.map((b, i) => [`${String(i + 1).padStart(3, '0')}.${ext(b)}`, [b, { level: 0 }]])) as Zippable)
const packText = (html: string) => zipSync({ [TEXT]: [new TextEncoder().encode(html), { level: 9 }] })

export const useSaved = create<SavedState>()(
  persist(
    (set, get) => ({
      items: {},
      titles: {},
      saveManga: (m, chapters, order) => {
        const items = { ...get().items }
        for (const c of chapters) {
          const key = savedKey(m.id, c.id)
          if (items[key] && items[key].status !== 'error') continue
          items[key] = {
            key,
            kind: 'manga',
            entry: m.id,
            chapterId: c.id,
            label: chapterName(c),
            order: order(c),
            status: 'queued',
            done: 0,
            total: c.pages,
            bytes: 0,
            addedAt: Date.now(),
            chapter: c,
          }
        }
        set({
          items,
          titles: {
            ...get().titles,
            [m.id]: {
              entry: m.id,
              kind: 'manga',
              title: m.ruTitle || m.title,
              cover: m.cover,
            },
          },
        })
        void storage.write(metaFile(m.id), JSON.stringify(m)).catch(() => {})
        void keepStorage()
        pump()
      },
      saveNovel: (src, n, ids) => {
        const entry = `ln-${src}-${encodeURIComponent(n.id)}`
        const items = { ...get().items }
        for (const id of ids) {
          const i = n.chapters.findIndex((c) => c.id === id)
          if (i < 0) continue
          const key = savedKey(entry, id)
          if (items[key] && items[key].status !== 'error') continue
          items[key] = {
            key,
            kind: 'novel',
            entry,
            chapterId: id,
            label: n.chapters[i].title,
            order: i,
            status: 'queued',
            done: 0,
            total: 1,
            bytes: 0,
            addedAt: Date.now(),
          }
        }
        set({
          items,
          titles: {
            ...get().titles,
            [entry]: {
              entry,
              kind: 'novel',
              title: n.title,
              cover: n.cover,
              src,
              novelId: n.id,
            },
          },
        })
        void storage.write(metaFile(entry), JSON.stringify(n)).catch(() => {})
        void keepStorage()
        pump()
      },
      remove: async (key) => {
        const it = get().items[key]
        if (!it) return
        active.get(key)?.abort()
        const { [key]: _, ...items } = get().items
        set({ items })
        forget(key)
        await storage.removeDir(archiveOf(it))
        await storage.removeDir(dirOf(it))
        const left = Object.values(items).some((i) => i.entry === it.entry)
        if (!left) {
          const { [it.entry]: __, ...titles } = get().titles
          set({ titles })
          await storage.removeDir(`chm-${safe(it.entry)}`)
        }
      },
      removeTitle: async (entry) => {
        for (const it of Object.values(get().items).filter((i) => i.entry === entry)) await get().remove(it.key)
      },
      retry: (key) => {
        get().patch(key, { status: 'queued', error: undefined })
        pump()
      },
      patch: (key, p) => {
        const it = get().items[key]
        if (it) set({ items: { ...get().items, [key]: { ...it, ...p } } })
      },
    }),
    {
      name: 'aniplayer-saved-chapters',
      // a chapter cut off by closing the app carries on at the next start
      onRehydrateStorage: () => (s) => {
        if (!s) return
        for (const it of Object.values(s.items)) if (it.status === 'saving') it.status = 'queued'
        setTimeout(pump, 2500)
      },
    },
  ),
)

const chapterName = (c: Chapter) => (c.num != null ? `${c.volume ? `Том ${c.volume} · ` : ''}Глава ${c.num}` : c.title || 'Ваншот')

/** a saved chapter, ready to read from the device */
export const savedChapter = (entry: string, chapterId: string) => {
  const it = useSaved.getState().items[savedKey(entry, chapterId)]
  return it?.status === 'done' ? it : null
}

// --- the queue: one chapter at a time, a few pages in parallel --------------------------------------

const active = new Map<string, AbortController>()
const PARALLEL = 4

// power saving: the one in progress finishes, the rest wait until the reader is closed
onPowerSaving((on) => !on && pump())

function pump() {
  if (active.size || powerSaving()) return
  const next = Object.values(useSaved.getState().items)
    .filter((i) => i.status === 'queued')
    .sort((a, b) => a.addedAt - b.addedAt || a.order - b.order)[0]
  if (next) void run(next)
}

/** an image's bytes from wherever it is: the PC app's main process, the native layer, or plain fetch */
async function bytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const bridge = window.aniplayer?.fetchImage
  if (bridge) return (await bridge(url)) as Uint8Array
  if (viaNative(url)) return mdBytes(url)
  if (isNative) {
    const r = await CapacitorHttp.get({ url, responseType: 'arraybuffer' })
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`)
    // the native layer hands binary bodies over as base64
    const b64 = typeof r.data === 'string' ? r.data : ''
    return new Uint8Array(await (await fetch(`data:application/octet-stream;base64,${b64}`)).arrayBuffer())
  }
  const res = await fetch(url, { signal, mode: 'cors' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function run(item: SavedChapter) {
  const s = useSaved.getState
  const ctl = new AbortController()
  active.set(item.key, ctl)
  s().patch(item.key, {
    status: 'saving',
    error: undefined,
    done: 0,
    bytes: 0,
  })
  try {
    if (item.kind === 'novel') {
      const { loadChapter } = await import('../ranobe/cache')
      const t = s().titles[item.entry]
      if (!t?.src || !t.novelId) throw new Error('Нет данных о ранобэ')
      const html = await loadChapter(t.src, t.novelId, item.chapterId, true)
      await storage.write(archiveOf(item), packText(html))
      s().patch(item.key, {
        status: 'done',
        done: 1,
        total: 1,
        bytes: new TextEncoder().encode(html).length,
      })
    } else {
      const { pages } = await import('./md')
      const { fallback, urls } = await pages(item.chapterId, false)
      s().patch(item.key, { total: urls.length })
      let next = 0
      let done = 0
      let size = 0
      const got: Uint8Array[] = []
      const worker = async () => {
        while (next < urls.length) {
          const i = next++
          if (ctl.signal.aborted) throw new Error('aborted')
          // a volunteer MD@Home node first, MangaDex's own servers when it fails
          let b: Uint8Array | null = null
          for (const u of [urls[i], fallback[i]]) {
            try {
              b = await bytes(u, ctl.signal)
              break
            } catch {
              /* next one */
            }
          }
          if (!b) throw new Error(`Не удалось скачать страницу ${i + 1}`)
          got[i] = b
          done++
          size += b.length
          s().patch(item.key, { done, bytes: size })
        }
      }
      await Promise.all(Array.from({ length: Math.min(PARALLEL, urls.length) }, worker))
      if (ctl.signal.aborted || !s().items[item.key]) throw new Error('aborted')
      await storage.write(archiveOf(item), packPages(got))
      s().patch(item.key, {
        status: 'done',
        done: urls.length,
        total: urls.length,
        bytes: size,
      })
    }
  } catch (e) {
    if (!ctl.signal.aborted && s().items[item.key])
      s().patch(item.key, {
        status: 'error',
        error: String((e as Error)?.message ?? e),
      })
  } finally {
    active.delete(item.key)
    pump()
  }
}

// --- reading from the device ------------------------------------------------------------------------

const opened = new Map<string, Promise<string[]>>()

function forget(key: string) {
  const p = opened.get(key)
  opened.delete(key)
  void p?.then((urls) => urls.forEach(URL.revokeObjectURL)).catch(() => {})
}

/** the chapter's archive, opened; null when it was saved the old way, as loose files */
async function openArchive(it: SavedChapter) {
  let zip: Uint8Array
  try {
    zip = await storage.read(archiveOf(it))
  } catch {
    return null
  }
  return unzipSync(zip)
}

/** an old loose chapter becomes an archive once it has been read whole */
function repack(it: SavedChapter, data: Uint8Array) {
  void storage
    .write(archiveOf(it), data)
    .then(() => storage.removeDir(dirOf(it)))
    .catch(() => {})
}

async function chapterPages(it: SavedChapter) {
  const files = await openArchive(it)
  if (files)
    return Object.keys(files)
      .filter((n) => /^\d+\.\w+$/.test(n))
      .sort()
      .map((n) => ({ bytes: files[n], type: MIME[n.split('.').pop()!] }))
  const dir = dirOf(it)
  const pages = await Promise.all(Array.from({ length: it.total }, (_, i) => storage.read(`${dir}/${i}`)))
  repack(it, packPages(pages))
  return pages.map((bytes) => ({ bytes, type: MIME[ext(bytes)] }))
}

/** a saved manga chapter's pages as local picture URLs; the few last opened stay ready */
export function savedPages(it: SavedChapter): Promise<string[]> {
  let p = opened.get(it.key)
  if (!p) {
    p = chapterPages(it).then((pages) => pages.map((pg) => URL.createObjectURL(new Blob([pg.bytes as BlobPart], { type: pg.type }))))
    opened.set(it.key, p)
    p.catch(() => opened.delete(it.key))
    if (opened.size > 4) forget(opened.keys().next().value!)
  }
  return p
}

export async function savedText(it: SavedChapter) {
  const files = await openArchive(it)
  if (files?.[TEXT]) return new TextDecoder().decode(files[TEXT])
  const html = new TextDecoder().decode(await storage.read(`${dirOf(it)}/${TEXT}`))
  repack(it, packText(html))
  return html
}

/** the title's data kept with its chapters, for opening it offline */
export async function savedMeta<T extends Manga | Novel>(entry: string): Promise<T | null> {
  try {
    return JSON.parse(new TextDecoder().decode(await storage.read(metaFile(entry)))) as T
  } catch {
    return null
  }
}

/** a manga's saved data, for the manga pages (never a ranobe's that happens to share the address) */
export async function savedManga(id: string) {
  const m = await savedMeta<Manga>(id)
  return m && Array.isArray(m.langs) ? (m as Manga & { score: number | null; follows: number | null }) : null
}

export const pct = (i: SavedChapter) => (i.total ? Math.round((i.done / i.total) * 100) : 0)
