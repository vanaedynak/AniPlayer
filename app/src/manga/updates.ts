// New chapters of what is being read, and when the next ones are likely. Titles on the shelf being read
// (or starred) are checked now and then: a chapter that wasn't there last time is new. The dates past
// chapters came out give each title its rhythm ("about every 7 days, on Fridays"), and from that a
// forecast. MangaDex dates every chapter; ranobe sources don't, so their rhythm is learned from when
// new chapters were noticed.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useManga, type MangaEntry } from './store'
import { recentChapters, chapterKey, chapterLabel } from './md'
import { skChapters } from './sk'
import { isNovelEntry, parseEntry, novelPath, chapterPath } from '../ranobe/shelf'
import { sourceById } from '../ranobe/registry'
import { isElectron } from '../lib/platform'
import { powerSaving } from '../lib/power'

export interface Fresh {
  chapters: { id: string; key: string; label: string }[]
  at: number
}

interface UpdatesState {
  /** chapter keys already seen per title (ranobe: chapter ids) */
  known: Record<string, string[]>
  /** chapters that came out since the reader last looked */
  fresh: Record<string, Fresh>
  /** when chapters came out, newest first (ms) */
  days: Record<string, number[]>
  checkedAt: number
  dismiss: (entry: string) => void
}

export const useUpdates = create<UpdatesState>()(
  persist(
    (set, get) => ({
      known: {},
      fresh: {},
      days: {},
      checkedAt: 0,
      dismiss: (entry) => {
        const { [entry]: _, ...fresh } = get().fresh
        set({ fresh })
      },
    }),
    { name: 'aniplayer-chapter-updates' },
  ),
)

const DAY = 86_400_000

/** the titles worth checking: being read or starred */
const followed = (entries: Record<string, MangaEntry>) =>
  Object.values(entries)
    .filter((e) => e.favorite || e.status === 'reading' || (!e.status && e.lastChapterId))
    .sort((a, b) => (b.lastReadAt ?? b.updatedAt) - (a.lastReadAt ?? a.updatedAt))
    .slice(0, 40)

async function latest(e: MangaEntry): Promise<{ key: string; id: string; label: string; at: number }[]> {
  if (isNovelEntry(e.id)) {
    const { src, novelId } = parseEntry(e.id)
    const n = await sourceById(src)?.novel(novelId)
    return (n?.chapters ?? []).map((c) => ({ key: c.id, id: c.id, label: c.title, at: 0 }))
  }
  const lang = e.lang ?? (useManga.getState().prefs.lang === 'any' ? 'en' : useManga.getState().prefs.lang)
  const list = e.id.startsWith('sk-') ? (await skChapters(e.id.slice(3))).reverse() : await recentChapters(e.id, lang)
  // one per chapter number, dated by its first translation
  const by = new Map<string, { key: string; id: string; label: string; at: number }>()
  for (const c of list) {
    const key = chapterKey(c)
    const cur = by.get(key)
    if (!cur || c.at < cur.at) by.set(key, { key, id: c.id, label: chapterLabel(c), at: c.at })
  }
  return [...by.values()].sort((a, b) => b.at - a.at)
}

let running = false

/** looks for new chapters; at most every half hour unless `force` */
export async function checkUpdates(force = false) {
  const s = useUpdates.getState()
  if (running || !navigator.onLine || (!force && Date.now() - s.checkedAt < 30 * 60_000)) return
  running = true
  const found: string[] = []
  try {
    for (const e of followed(useManga.getState().entries)) {
      let list
      try {
        list = await latest(e)
      } catch {
        continue
      }
      if (!list.length) continue
      const st = useUpdates.getState()
      const known = new Set(st.known[e.id] ?? [])
      const first = !st.known[e.id]
      const read = new Set(e.read)
      const news = first ? [] : list.filter((c) => !known.has(c.key) && !read.has(c.key))
      const novel = isNovelEntry(e.id)
      // dates: MangaDex gives them, for ranobe the moment new chapters were noticed
      const days = novel ? (news.length ? [Date.now(), ...(st.days[e.id] ?? [])] : (st.days[e.id] ?? [])) : list.map((c) => c.at).filter(Boolean)
      const fresh = { ...st.fresh }
      if (news.length) {
        const old = fresh[e.id]?.chapters ?? []
        fresh[e.id] = { chapters: [...news.map((c) => ({ id: c.id, key: c.key, label: c.label })), ...old].slice(0, 20), at: Date.now() }
        found.push(e.title)
      }
      useUpdates.setState({
        known: { ...st.known, [e.id]: [...new Set([...list.map((c) => c.key), ...known])].slice(-3000) },
        days: { ...st.days, [e.id]: days.slice(0, 16) },
        fresh,
      })
    }
    useUpdates.setState({ checkedAt: Date.now() })
  } finally {
    running = false
  }
  // the PC app tells about them with a system notification
  if (found.length && isElectron && document.visibilityState !== 'visible' && 'Notification' in window)
    new Notification('Новые главы', { body: found.slice(0, 4).join(', ') + (found.length > 4 ? ` и ещё ${found.length - 4}` : '') })
}

export function initUpdates() {
  setTimeout(() => void checkUpdates(), 20_000)
  setInterval(() => !powerSaving() && void checkUpdates(), 3 * 3600_000)
}

/** where a title's page is */
export const titlePath = (entry: string) => {
  if (!isNovelEntry(entry)) return `/manga/${entry}`
  const { src, novelId } = parseEntry(entry)
  return novelPath(src, novelId)
}
export const readPath = (entry: string, chapterId: string) => {
  if (!isNovelEntry(entry)) return `/manga/read/${entry}/${chapterId}`
  const { src, novelId } = parseEntry(entry)
  return chapterPath(src, novelId, chapterId)
}

export interface Forecast {
  /** the day the next chapter is expected (local midnight, ms) */
  next: number
  /** days between chapters, as usual for it */
  every: number
  /** 0 Monday … 6 Sunday, when it keeps to one */
  weekday: number | null
}

const midnight = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const weekdayOf = (t: number) => (new Date(t).getDay() + 6) % 7

/** when the next chapter is likely, from how the past ones came out; null when there is no rhythm to go by */
export function forecast(times: number[] | undefined): Forecast | null {
  if (!times || times.length < 3) return null
  const days = [...new Set(times.map(midnight))].sort((a, b) => b - a)
  if (days.length < 3) return null
  const gaps = days.slice(0, -1).map((d, i) => Math.round((d - days[i + 1]) / DAY)).filter((g) => g > 0)
  if (gaps.length < 2) return null
  const every = Math.max(1, [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)])
  if (every > 45) return null
  const today = midnight(Date.now())
  // gone quiet for much longer than usual: no forecast to make
  if (today - days[0] > every * 3 * DAY) return null
  const counts = new Array(7).fill(0)
  days.forEach((d) => counts[weekdayOf(d)]++)
  const top = counts.indexOf(Math.max(...counts))
  const weekday = every >= 6 && every <= 8 && counts[top] >= days.length * 0.6 ? top : null
  let next = days[0] + every * DAY
  while (next < today) next += every * DAY
  if (weekday != null) while (weekdayOf(next) !== weekday) next += DAY
  return { next: midnight(next + DAY / 2), every, weekday }
}
