// Reading state: shelf, last position, read chapters and reader settings.
// Shelf entries follow the account to other devices (user_docs, kind "manga").
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { pushDoc, registerDocs } from '../lib/sync'
import { setAdult, type Manga } from './md'
import { countFinished } from '../lib/activity'
import { isSignedIn, needAccount } from '../lib/guest'

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
export type Paper = keyof typeof import('./ui').PAPER

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
  /** up to five Gemini keys (one per Google account): when one runs out, the next takes over */
  geminiKeys: string[]
  geminiModel: string
  /** page mode magnification on top of the fit (1 = as fitted), kept from page to page */
  pageZoom?: number
  /** page mode: pages turn like paper (off: they just change) */
  curl?: boolean
  /** the paper turn makes its sound */
  flipSound?: boolean
  /** lettering of translated bubbles */
  bubbleFont?: import('./bubbleFont').BubbleFont
  /** pages translated ahead of the one on screen */
  ahead?: number
}

export interface BookPrefs {
  size: number
  leading: number
  font: import('../read/bookLook').BookFont
  paper: Paper
  width: number
  justify: boolean
  indent: boolean
  /** show chapters that are not in Russian translated by Gemini */
  translate: boolean
  /** turn the text a screen at a time instead of scrolling (online ranobe) */
  paged?: boolean
  /** page mode: pages turn like paper */
  curl?: boolean
  flipSound?: boolean
  /** page mode: one page or a two-page spread (auto: two on a wide screen) */
  spread?: 'auto' | 'one' | 'two'
  /** space around the text on a page */
  margins?: 'narrow' | 'normal' | 'wide'
  /** text weight, 300…600 */
  weight?: number
  /** extra space between paragraphs, in em */
  para?: number
  /** a large first letter at the start of a chapter */
  dropCap?: boolean
  /** the book's and the chapter's names at the top of the pages */
  runningHead?: boolean
  /** text a little softer than full black (or white) */
  softText?: boolean
}

/** the room around the page: paper texture, light, warmth and a quiet sound, shared by every reader */
export interface Ambience {
  texture: 'none' | 'paper' | 'old' | 'linen'
  /** a warm evening light over the page, 0…1 (less blue for the eyes) */
  warmth: number
  /** a dimmer on top of the screen's own, 0…0.7 */
  dim: number
  light: 'none' | 'lamp' | 'window'
  sound: 'off' | 'rain' | 'fire' | 'night'
  volume: number
}

interface MangaState {
  entries: Record<string, MangaEntry>
  prefs: ReaderPrefs
  book: BookPrefs
  amb: Ambience
  /** pages turned per day, for the reader's own progress */
  pagesRead: { day: string; today: number; total: number }
  countPage: () => number
  setAmb: (p: Partial<Ambience>) => void
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
      prefs: { mode: 'scroll', fit: 'height', gap: false, width: 760, paper: 'dark', saver: false, brightness: 1, lang: 'ru', adult: false, spread: false, translate: true, geminiKeys: [], geminiModel: 'gemini-3.8-flash' },
      book: { size: 19, leading: 1.7, font: 'literata', paper: 'dark', width: 720, justify: true, indent: true, translate: false, paged: true, spread: 'auto', margins: 'normal', weight: 400, para: 0.3, dropCap: true, runningHead: true },
      amb: { texture: 'none', warmth: 0, dim: 0, light: 'none', sound: 'off', volume: 0.5 },
      pagesRead: { day: '', today: 0, total: 0 },
      countPage: () => {
        const day = new Date().toDateString()
        const cur = get().pagesRead
        const next = { day, today: (cur.day === day ? cur.today : 0) + 1, total: cur.total + 1 }
        set({ pagesRead: next })
        return next.today
      },
      setAmb: (p) => set({ amb: { ...get().amb, ...p } }),

      touch: (m, patch) => {
        if ('status' in patch || 'favorite' in patch ? !needAccount('Полка: «Читаю», «В планах» и избранное') : !isSignedIn()) return
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
        if (!cur || !isSignedIn()) return
        const read = p.done && !cur.read.includes(p.key) ? [...cur.read, p.key] : cur.read
        if (read !== cur.read) countFinished(mangaId.startsWith('ln-') ? 'l' : 'c', `${mangaId}:${p.key}`)
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
        if (!needAccount('Отмечать прочитанные главы')) return
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
      version: 3,
      // v2: Flash 3.8 is tried first now (Flash-Lite stays as its fallback)
      migrate: (p, v) => {
        const s = p as Partial<MangaState>
        if (v < 2 && s.prefs) s.prefs = { ...s.prefs, geminiModel: 'gemini-3.8-flash' }
        // v3: one key became a list of keys
        if (v < 3 && s.prefs) {
          const { geminiKey, ...rest } = s.prefs as ReaderPrefs & { geminiKey?: string }
          s.prefs = { ...rest, geminiKeys: geminiKey ? [geminiKey] : [] }
        }
        return s as MangaState
      },
      // settings added later get their defaults
      merge: (p, cur) => {
        const saved = (p ?? {}) as Partial<MangaState>
        const prefs = { ...cur.prefs, ...saved.prefs }
        // model names Google has since retired
        if (/-latest$/.test(prefs.geminiModel)) prefs.geminiModel = cur.prefs.geminiModel
        return { ...cur, ...saved, prefs, book: { ...cur.book, ...saved.book }, amb: { ...cur.amb, ...saved.amb }, pagesRead: { ...cur.pagesRead, ...saved.pagesRead } }
      },
      onRehydrateStorage: () => (s) => s && setAdult(s.prefs.adult),
    },
  ),
)

// --- sync -----------------------------------------------------------------------------------------

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pending = new Map<string, MangaEntry>()

function write(e: MangaEntry) {
  pending.delete(e.id)
  pushDoc('manga', e.id, e, e.updatedAt)
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

export function initMangaSync() {
  registerDocs<MangaEntry>(
    'manga',
    (e) => e.id,
    () => Object.values(useManga.getState().entries),
    (list) => useManga.getState().mergeRemote(list),
  )
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushManga())
  window.addEventListener('pagehide', flushManga)
}
