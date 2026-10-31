// Reading state: shelf, last position, read chapters and reader settings.
// Shelf entries follow the account to other devices through Firestore (users/{uid}/manga/{id}).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { collection, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore'
import { firestore, useSync } from '../lib/sync'
import { setAdult, type Manga } from './md'

export type ReadStatus = 'reading' | 'planned' | 'completed' | 'postponed' | 'dropped'
export const READ_LABELS: Record<ReadStatus, string> = {
  reading: 'Читаю',
  planned: 'В планах',
  completed: 'Прочитано',
  postponed: 'Отложено',
  dropped: 'Брошено',
}

export interface MangaEntry {
  id: string
  title: string
  cover: string
  kind: string
  status?: ReadStatus | null
  favorite?: boolean
  lang?: string
  group?: string
  lastChapterId?: string
  lastLabel?: string
  lastPage?: number
  lastPages?: number
  lastReadAt?: number
  /** chapter numbers, so a chapter counts as read whichever group translated it */
  read: string[]
  updatedAt: number
}

export type ReaderMode = 'scroll' | 'rtl' | 'ltr'
export type ReaderFit = 'width' | 'height' | 'original'
export type Paper = 'dark' | 'black' | 'sepia' | 'light'

export interface ReaderPrefs {
  mode: ReaderMode
  fit: ReaderFit
  gap: boolean
  width: number
  paper: Paper
  saver: boolean
  brightness: number
  lang: string
  adult: boolean
  spread: boolean
  /** translate pages of chapters that aren't in Russian */
  translate: boolean
  geminiKey: string
  geminiModel: string
}

export interface BookPrefs {
  size: number
  leading: number
  font: 'serif' | 'sans' | 'mono'
  paper: Paper
  width: number
  justify: boolean
  indent: boolean
}

interface MangaState {
  entries: Record<string, MangaEntry>
  prefs: ReaderPrefs
  book: BookPrefs
  touch: (m: Pick<Manga, 'id' | 'title' | 'cover' | 'lang'> & { ruTitle?: string }, patch: Partial<MangaEntry>) => void
  progress: (mangaId: string, p: { chapterId: string; label: string; page: number; pages: number; key: string; done: boolean }) => void
  toggleRead: (mangaId: string, keys: string[], read: boolean) => void
  setPrefs: (p: Partial<ReaderPrefs>) => void
  setBook: (p: Partial<BookPrefs>) => void
  mergeRemote: (list: MangaEntry[]) => void
}

const kindOf = (lang: string) => (lang === 'ko' ? 'Манхва' : lang.startsWith('zh') ? 'Маньхуа' : 'Манга')

export const useManga = create<MangaState>()(
  persist(
    (set, get) => ({
      entries: {},
      prefs: { mode: 'scroll', fit: 'height', gap: false, width: 760, paper: 'dark', saver: false, brightness: 1, lang: 'ru', adult: false, spread: false, translate: true, geminiKey: '', geminiModel: 'gemini-3.8-flash' },
      book: { size: 19, leading: 1.7, font: 'serif', paper: 'dark', width: 720, justify: true, indent: true },

      touch: (m, patch) => {
        const cur = get().entries[m.id]
        const e: MangaEntry = {
          ...cur,
          read: cur?.read ?? [],
          id: m.id,
          title: m.ruTitle || m.title,
          cover: m.cover,
          kind: kindOf(m.lang),
          ...patch,
          updatedAt: Date.now(),
        }
        set({ entries: { ...get().entries, [m.id]: e } })
        push(e, 'now')
      },

      progress: (mangaId, p) => {
        const cur = get().entries[mangaId]
        if (!cur) return
        const read = p.done && !cur.read.includes(p.key) ? [...cur.read, p.key] : cur.read
        const e: MangaEntry = {
          ...cur,
          lastChapterId: p.chapterId,
          lastLabel: p.label,
          lastPage: p.page,
          lastPages: p.pages,
          lastReadAt: Date.now(),
          status: cur.status ?? 'reading',
          read,
          updatedAt: Date.now(),
        }
        set({ entries: { ...get().entries, [mangaId]: e } })
        push(e, read !== cur.read ? 'now' : 'later')
      },

      toggleRead: (mangaId, keys, read) => {
        const cur = get().entries[mangaId]
        if (!cur) return
        const s = new Set(cur.read)
        keys.forEach((k) => (read ? s.add(k) : s.delete(k)))
        const e = { ...cur, read: [...s], updatedAt: Date.now() }
        set({ entries: { ...get().entries, [mangaId]: e } })
        push(e, 'now')
      },

      setPrefs: (p) => {
        set({ prefs: { ...get().prefs, ...p } })
        if (p.adult !== undefined) setAdult(p.adult)
      },
      setBook: (p) => set({ book: { ...get().book, ...p } }),

      mergeRemote: (list) => {
        const entries = { ...get().entries }
        let changed = false
        for (const r of list) {
          if ((entries[r.id]?.updatedAt ?? 0) < r.updatedAt) {
            entries[r.id] = { ...r, read: r.read ?? [] }
            changed = true
          }
        }
        if (changed) set({ entries })
      },
    }),
    {
      name: 'aniplayer-manga',
      version: 2,
      // v2: Flash 3.8 is tried first now (Flash-Lite stays as its fallback)
      migrate: (p, v) => {
        const s = p as Partial<MangaState>
        if (v < 2 && s.prefs) s.prefs = { ...s.prefs, geminiModel: 'gemini-3.8-flash' }
        return s as MangaState
      },
      // settings added later get their defaults
      merge: (p, cur) => {
        const saved = (p ?? {}) as Partial<MangaState>
        const prefs = { ...cur.prefs, ...saved.prefs }
        // model names Google has since retired
        if (/-latest$/.test(prefs.geminiModel)) prefs.geminiModel = cur.prefs.geminiModel
        return { ...cur, ...saved, prefs, book: { ...cur.book, ...saved.book } }
      },
      onRehydrateStorage: () => (s) => s && setAdult(s.prefs.adult),
    },
  ),
)

// --- Firestore ----------------------------------------------------------------------------------

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pending = new Map<string, MangaEntry>()

function write(e: MangaEntry) {
  const f = firestore()
  pending.delete(e.id)
  if (f) setDoc(doc(f.db, 'users', f.uid, 'manga', e.id), JSON.parse(JSON.stringify(e))).catch((err) => console.error('[manga sync]', err))
}

/** page turns are batched; shelf and read-mark changes go out at once */
function push(e: MangaEntry, when: 'now' | 'later') {
  clearTimeout(timers.get(e.id))
  pending.set(e.id, e)
  if (when === 'now') write(e)
  else timers.set(e.id, setTimeout(() => write(e), 8000))
}

export function flushManga() {
  for (const e of pending.values()) write(e)
  timers.forEach(clearTimeout)
  timers.clear()
}

let unsub: (() => void) | null = null
let listeningFor = ''

function listen() {
  const f = firestore()
  if (!f) {
    unsub?.()
    unsub = null
    listeningFor = ''
    return
  }
  if (listeningFor === f.uid) return
  unsub?.()
  listeningFor = f.uid
  let first = true
  unsub = onSnapshot(
    collection(f.db, 'users', f.uid, 'manga'),
    (snap) => {
      const remote = snap.docs.map((d) => d.data() as MangaEntry)
      useManga.getState().mergeRemote(remote)
      if (first && !snap.metadata.fromCache) {
        first = false
        // entries made on this device before signing in
        const have = new Map(remote.map((r) => [r.id, r.updatedAt]))
        const send = Object.values(useManga.getState().entries).filter((e) => (have.get(e.id) ?? 0) < e.updatedAt)
        if (send.length) {
          const b = writeBatch(f.db)
          send.slice(0, 400).forEach((e) => b.set(doc(f.db, 'users', f.uid, 'manga', e.id), JSON.parse(JSON.stringify(e))))
          void b.commit().catch((err) => console.error('[manga sync]', err))
        }
      }
    },
    (err) => console.error('[manga sync]', err),
  )
}

export function initMangaSync() {
  listen()
  useSync.subscribe(listen)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushManga())
  window.addEventListener('pagehide', flushManga)
}
