// Chapters saved for reading without the internet, manga and ranobe alike. Manga keeps every page image,
// ranobe the chapter's text; next to them, the title's own data (its chapter list), so the title opens
// offline too. Files live in the same device storage as downloaded episodes.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CapacitorHttp } from '@capacitor/core'
import { storage, keepStorage } from '../lib/offline'
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

function pump() {
  if (active.size) return
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
  const dir = dirOf(item)
  try {
    if (item.kind === 'novel') {
      const { loadChapter } = await import('../ranobe/cache')
      const t = s().titles[item.entry]
      if (!t?.src || !t.novelId) throw new Error('Нет данных о ранобэ')
      const html = await loadChapter(t.src, t.novelId, item.chapterId, true)
      await storage.write(`${dir}/text.html`, html)
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
          await storage.write(`${dir}/${i}`, b)
          done++
          size += b.length
          s().patch(item.key, { done, bytes: size })
        }
      }
      await Promise.all(Array.from({ length: Math.min(PARALLEL, urls.length) }, worker))
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

/** a saved manga chapter's pages as local picture URLs; the few last opened stay ready */
export function savedPages(it: SavedChapter): Promise<string[]> {
  let p = opened.get(it.key)
  if (!p) {
    const dir = dirOf(it)
    p = Promise.all(Array.from({ length: it.total }, async (_, i) => URL.createObjectURL(new Blob([(await storage.read(`${dir}/${i}`)) as BlobPart]))))
    opened.set(it.key, p)
    p.catch(() => opened.delete(it.key))
    if (opened.size > 4) forget(opened.keys().next().value!)
  }
  return p
}

export async function savedText(it: SavedChapter) {
  return new TextDecoder().decode(await storage.read(`${dirOf(it)}/text.html`))
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
