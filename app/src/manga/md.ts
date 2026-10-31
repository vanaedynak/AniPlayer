// MangaDex: the open manga catalog with an official public API (https://api.mangadex.org/docs).
// Russian titles and descriptions come from Shikimori, whose manga ids match MangaDex's "mal" link.
import { CapacitorHttp } from '@capacitor/core'
import { isIOS, isNative } from '../lib/platform'

const API = 'https://api.mangadex.org'
const SHIKI = 'https://shikimori.io'
const COVERS = 'https://uploads.mangadex.org/covers'

type Params = Record<string, string | number | boolean | (string | number)[] | undefined>

export interface Manga {
  id: string
  title: string
  ruTitle: string
  altTitle: string
  description: string
  cover: string
  status: string
  year: number | null
  tags: string[]
  rating: string
  lang: string
  langs: string[]
  mal: number | null
  authors: string[]
  demographic: string | null
  lastChapter: string | null
}

export interface Chapter {
  id: string
  num: string | null
  volume: string | null
  title: string
  pages: number
  lang: string
  group: string
  external: string | null
  at: number
}

export const STATUS: Record<string, string> = { ongoing: 'Выходит', completed: 'Завершена', hiatus: 'Перерыв', cancelled: 'Заброшена' }
export const LANGS: Record<string, string> = {
  ru: 'Русский',
  en: 'English',
  uk: 'Українська',
  ja: '日本語',
  'pt-br': 'Português',
  es: 'Español',
  'es-la': 'Español (LATAM)',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pl: 'Polski',
  id: 'Indonesia',
  vi: 'Tiếng Việt',
  tr: 'Türkçe',
}
export const KIND = (lang: string) => (lang === 'ko' ? 'Манхва' : lang.startsWith('zh') ? 'Маньхуа' : 'Манга')

// tags shown as genre chips, with Russian names; ids are looked up from /manga/tag
export const GENRES: Record<string, string> = {
  Action: 'Экшен',
  Adventure: 'Приключения',
  Comedy: 'Комедия',
  Drama: 'Драма',
  Fantasy: 'Фэнтези',
  Romance: 'Романтика',
  'Slice of Life': 'Повседневность',
  Isekai: 'Исекай',
  'Sci-Fi': 'Фантастика',
  Psychological: 'Психология',
  Mystery: 'Детектив',
  Horror: 'Ужасы',
  Thriller: 'Триллер',
  Sports: 'Спорт',
  Tragedy: 'Трагедия',
  Historical: 'История',
  'School Life': 'Школа',
  Supernatural: 'Сверхъестественное',
  'Martial Arts': 'Боевые искусства',
  Reincarnation: 'Перерождение',
  Magic: 'Магия',
  Mecha: 'Меха',
  Monsters: 'Монстры',
  'Video Games': 'Игры',
  Survival: 'Выживание',
  'Post-Apocalyptic': 'Постапокалипсис',
  Military: 'Военное',
  Music: 'Музыка',
  Cooking: 'Кулинария',
  Medical: 'Медицина',
  Crime: 'Криминал',
  Superhero: 'Супергерои',
  Vampires: 'Вампиры',
  Demons: 'Демоны',
  Harem: 'Гарем',
  Villainess: 'Злодейка',
  'Long Strip': 'Веб-комикс',
  'Full Color': 'Цветная',
  Oneshot: 'Ваншот',
}

// MangaDex asks for at most ~5 requests a second: space the calls a little
let chain: Promise<unknown> = Promise.resolve()
const cache = new Map<string, { at: number; p: Promise<unknown> }>()

function query(params: Params) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => qs.append(`${k}[]`, String(x)))
    else qs.set(k, String(v))
  }
  return qs.toString()
}

async function fetchJson<T>(url: string): Promise<T> {
  // iPad: capacitor:// is not an allowed CORS origin, so the request goes through the native layer
  if (isNative && isIOS) {
    const res = await CapacitorHttp.get({ url, headers: { Accept: 'application/json' } })
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
    return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T
  }
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(res.status === 429 ? 'Слишком много запросов, подождите минуту' : `HTTP ${res.status}`)
  return res.json() as Promise<T>
}

function get<T>(path: string, params: Params = {}, ttl = 10 * 60_000): Promise<T> {
  const qs = query(params)
  const url = `${API}${path}${qs ? '?' + qs : ''}`
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < ttl) return hit.p as Promise<T>
  const p = (chain = chain.then(() => new Promise((r) => setTimeout(r, 160)))).then(() => fetchJson<T>(url))
  p.catch(() => cache.delete(url))
  cache.set(url, { at: Date.now(), p })
  return p
}

interface Rel {
  id: string
  type: string
  attributes?: Record<string, unknown>
}
interface RawManga {
  id: string
  attributes: {
    title: Record<string, string>
    altTitles: Record<string, string>[]
    description: Record<string, string>
    status: string
    year: number | null
    tags: { attributes: { name: { en: string } } }[]
    contentRating: string
    originalLanguage: string
    availableTranslatedLanguages: (string | null)[]
    links: Record<string, string> | null
    publicationDemographic: string | null
    lastChapter: string | null
  }
  relationships: Rel[]
}

const pick = (m: Record<string, string>, ...langs: string[]) => {
  for (const l of langs) if (m[l]) return m[l]
  return Object.values(m)[0] ?? ''
}

function toManga(r: RawManga): Manga {
  const a = r.attributes
  const alt = (lang: string) => a.altTitles.find((t) => t[lang])?.[lang]
  const cover = r.relationships.find((x) => x.type === 'cover_art')?.attributes?.fileName as string | undefined
  const title = pick(a.title, 'en', 'ja-ro', 'ko-ro', 'zh-ro', 'ja')
  return {
    id: r.id,
    title,
    ruTitle: alt('ru') ?? '',
    altTitle: alt('en') && alt('en') !== title ? alt('en')! : (alt('ja') ?? alt('ko') ?? ''),
    description: pick(a.description, 'ru', 'en'),
    cover: cover ? `${COVERS}/${r.id}/${cover}` : '',
    status: a.status,
    year: a.year,
    tags: a.tags.map((t) => t.attributes.name.en),
    rating: a.contentRating,
    lang: a.originalLanguage,
    langs: a.availableTranslatedLanguages.filter(Boolean) as string[],
    mal: a.links?.mal ? Number(a.links.mal) : null,
    authors: [
      ...new Set(r.relationships.filter((x) => x.type === 'author' || x.type === 'artist').map((x) => String(x.attributes?.name ?? '')).filter(Boolean)),
    ],
    demographic: a.publicationDemographic,
    lastChapter: a.lastChapter || null,
  }
}

/** 256px thumbnails for cards, 512px for the title page */
export const coverUrl = (m: { cover: string }, size: 256 | 512 = 256) => (m.cover ? `${m.cover}.${size}.jpg` : '')
export const mangaName = (m: { ruTitle?: string; title: string }) => m.ruTitle || m.title

let adult = false
/** 18+ titles stay hidden unless the reader turns them on */
export const setAdult = (v: boolean) => void (adult = v)
const ratings = () => (adult ? ['safe', 'suggestive', 'erotica'] : ['safe', 'suggestive'])

// --- Russian names from Shikimori ---------------------------------------------------------------

interface ShikiManga {
  id: number
  name: string
  russian: string
  description?: string | null
  score?: string
}
const ruNames = new Map<number, string>()

async function shiki<T>(path: string): Promise<T> {
  const res = await fetch(`${SHIKI}/api/${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Shikimori HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** fills ruTitle for titles MangaDex only knows in English */
async function withRussian(list: Manga[]) {
  const need = [...new Set(list.filter((m) => !m.ruTitle && m.mal && !ruNames.has(m.mal)).map((m) => m.mal!))]
  if (need.length) {
    const found = await shiki<ShikiManga[]>(`mangas?ids=${need.join(',')}&limit=50`).catch(() => [])
    for (const s of found) ruNames.set(s.id, s.russian)
    for (const id of need) if (!ruNames.has(id)) ruNames.set(id, '')
  }
  return list.map((m) => (m.ruTitle || !m.mal ? m : { ...m, ruTitle: ruNames.get(m.mal) ?? '' }))
}

// --- catalog ------------------------------------------------------------------------------------

let tagIds: Promise<Record<string, string>> | null = null
export function tags() {
  tagIds ??= get<{ data: { id: string; attributes: { name: { en: string } } }[] }>('/manga/tag', {}, 24 * 3600_000).then((r) =>
    Object.fromEntries(r.data.map((t) => [t.attributes.name.en, t.id])),
  )
  return tagIds
}

export interface ListOpts {
  title?: string
  order?: 'followedCount' | 'latestUploadedChapter' | 'relevance' | 'rating' | 'createdAt'
  genre?: string
  lang?: string
  offset?: number
  limit?: number
  ratings?: string[]
}

export async function list(o: ListOpts): Promise<{ items: Manga[]; total: number }> {
  const tagId = o.genre ? (await tags())[o.genre] : undefined
  const r = await get<{ data: RawManga[]; total: number }>('/manga', {
    title: o.title,
    limit: o.limit ?? 24,
    offset: o.offset ?? 0,
    includes: ['cover_art'],
    contentRating: o.ratings ?? ratings(),
    availableTranslatedLanguage: o.lang && o.lang !== 'any' ? [o.lang] : undefined,
    hasAvailableChapters: o.title ? undefined : 'true',
    includedTags: tagId ? [tagId] : undefined,
    [`order[${o.order ?? (o.title ? 'relevance' : 'followedCount')}]`]: 'desc',
  })
  return { items: await withRussian(r.data.map(toManga)), total: r.total }
}

/** search by any name; Russian names also go through Shikimori, which knows them better */
export async function search(q: string, offset = 0): Promise<{ items: Manga[]; total: number; hidden: number }> {
  // with 18+ off, also count what the filter hides, so the page can offer to show it
  const [found, hidden] = await Promise.all([
    find(q, offset),
    adult || offset ? Promise.resolve(0) : find(q, 0, ['erotica'], 1).then((r) => r.items.length || r.total).catch(() => 0),
  ])
  return { ...found, hidden }
}

async function find(q: string, offset: number, only?: string[], limit?: number) {
  const direct = list({ title: q, offset, ratings: only, limit })
  if (offset || !/[а-яё]/i.test(q)) return direct
  const viaShiki = (async () => {
    const hits = await shikiSearch(q)
    const found = await Promise.all(
      hits.slice(0, 4).map(async (h) => {
        ruNames.set(h.id, h.russian)
        const r = await list({ title: h.name, limit: 5, ratings: only }).catch(() => null)
        return r?.items.find((m) => m.mal === h.id) ?? null
      }),
    )
    return found.filter((m): m is Manga => !!m)
  })()
  const [d, s] = await Promise.all([direct, viaShiki])
  const seen = new Set<string>()
  const items = [...s, ...d.items].filter((m) => !seen.has(m.id) && !!seen.add(m.id))
  return { items, total: Math.max(d.total, items.length) }
}

const shikiHits = new Map<string, Promise<ShikiManga[]>>()
function shikiSearch(q: string) {
  if (!shikiHits.has(q)) shikiHits.set(q, shiki<ShikiManga[]>(`mangas?search=${encodeURIComponent(q)}&limit=5&order=popularity`).catch(() => []))
  return shikiHits.get(q)!
}

export async function manga(id: string): Promise<Manga & { score: number | null; follows: number | null }> {
  const [r, st] = await Promise.all([
    get<{ data: RawManga }>(`/manga/${id}`, { includes: ['cover_art', 'author', 'artist'] }),
    get<{ statistics: Record<string, { rating: { bayesian: number | null }; follows: number | null }> }>(`/statistics/manga/${id}`).catch(() => null),
  ])
  let m = toManga(r.data)
  // a Russian description beats an English one
  if (m.mal && !r.data.attributes.description.ru) {
    const s = await shiki<ShikiManga>(`mangas/${m.mal}`).catch(() => null)
    if (s) m = { ...m, ruTitle: m.ruTitle || s.russian, description: s.description ? cleanShiki(s.description) : m.description }
  } else [m] = await withRussian([m])
  const stat = st?.statistics[id]
  return { ...m, score: stat?.rating.bayesian ?? null, follows: stat?.follows ?? null }
}

// Shikimori markup: [character=1]Name[/character], [i]…[/i]
const cleanShiki = (s: string) => s.replace(/\[\/?[a-z_]+(=[^\]]*)?\]/gi, '').trim()

interface RawChapter {
  id: string
  attributes: {
    chapter: string | null
    volume: string | null
    title: string | null
    pages: number
    translatedLanguage: string
    externalUrl: string | null
    readableAt: string
  }
  relationships: Rel[]
}

/** every chapter of a title in one language, all translation groups */
export async function chapters(id: string, lang: string): Promise<Chapter[]> {
  const out: Chapter[] = []
  for (let offset = 0; offset < 5000; offset += 500) {
    const r = await get<{ data: RawChapter[]; total: number }>(
      `/manga/${id}/feed`,
      {
        limit: 500,
        offset,
        translatedLanguage: [lang],
        includes: ['scanlation_group'],
        contentRating: ['safe', 'suggestive', 'erotica', 'pornographic'],
        'order[volume]': 'asc',
        'order[chapter]': 'asc',
        includeEmptyPages: 0,
      },
      3 * 60_000,
    )
    for (const c of r.data) {
      const a = c.attributes
      out.push({
        id: c.id,
        num: a.chapter,
        volume: a.volume,
        title: a.title ?? '',
        pages: a.pages,
        lang: a.translatedLanguage,
        group: String(c.relationships.find((x) => x.type === 'scanlation_group')?.attributes?.name ?? ''),
        external: a.externalUrl,
        at: Date.parse(a.readableAt),
      })
    }
    if (offset + 500 >= r.total) break
  }
  return out
}

/** one entry per chapter number: the preferred group's version, else the most prolific group's */
export function dedupe(list: Chapter[], prefer?: string) {
  const count = new Map<string, number>()
  for (const c of list) count.set(c.group, (count.get(c.group) ?? 0) + 1)
  const score = (c: Chapter) => (c.group === prefer ? 1e6 : 0) + (c.external ? -1e5 : 0) + (count.get(c.group) ?? 0)
  const by = new Map<string, Chapter>()
  for (const c of list) {
    const key = chapterKey(c)
    const cur = by.get(key)
    if (!cur || score(c) > score(cur)) by.set(key, c)
  }
  return [...by.values()].sort((a, b) => num(a) - num(b))
}

export const chapterKey = (c: Pick<Chapter, 'num' | 'id'>) => c.num ?? c.id
const num = (c: Chapter) => (c.num != null ? parseFloat(c.num) : -1)
export const chapterLabel = (c: Pick<Chapter, 'num' | 'volume' | 'title'>) =>
  c.num != null ? `${c.volume ? `Том ${c.volume} · ` : ''}Глава ${c.num}` : c.title || 'Ваншот'

/** image urls for a chapter; the at-home server address is valid for ~15 minutes */
export async function pages(chapterId: string, saver: boolean) {
  const r = await get<{ baseUrl: string; chapter: { hash: string; data: string[]; dataSaver: string[] } }>(`/at-home/server/${chapterId}`, {}, 10 * 60_000)
  const dir = saver ? 'data-saver' : 'data'
  const files = saver ? r.chapter.dataSaver : r.chapter.data
  return {
    urls: files.map((f) => `${r.baseUrl}/${dir}/${r.chapter.hash}/${f}`),
    // MangaDex's own servers, used when a volunteer MD@Home node fails
    fallback: files.map((f) => `https://uploads.mangadex.org/${dir}/${r.chapter.hash}/${f}`),
  }
}
