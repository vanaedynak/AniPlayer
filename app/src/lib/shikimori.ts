// Shikimori: full anime catalog with Russian titles. Shikimori ids equal MyAnimeList ids,
// which is how titles are matched to AniLibria releases and AniSkip/AniList.
import type { Release } from './api'

const HOST = 'https://shikimori.io'
export const shImg = (path?: string | null) => (!path ? '' : path.startsWith('http') ? path : HOST + path)

export interface ShikiAnime {
  id: number
  name: string
  russian: string
  image: { original: string; preview: string; x96?: string }
  kind: string | null
  score: string
  status: string
  episodes: number
  episodes_aired: number
  aired_on: string | null
  released_on?: string | null
  description?: string | null
  duration?: number
  genres?: { id: number; russian: string; name: string }[]
  rating?: string
}

export const KINDS: Record<string, string> = {
  tv: 'ТВ',
  movie: 'Фильм',
  ova: 'OVA',
  ona: 'ONA',
  special: 'Спешл',
  tv_special: 'ТВ-спешл',
  music: 'Клип',
}
export const STATUSES: Record<string, string> = { anons: 'Анонс', ongoing: 'Онгоинг', released: 'Вышло' }
export const SHIKI_ORDERS = [
  { value: 'popularity', label: 'По популярности' },
  { value: 'ranked', label: 'По рейтингу' },
  { value: 'aired_on', label: 'Сначала новые' },
]

// Shikimori allows ~5 requests per second: keep a small gap between calls
let chain: Promise<unknown> = Promise.resolve()
const cache = new Map<string, Promise<unknown>>()
function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const url = `${HOST}/api/${path}${qs.size ? '?' + qs : ''}`
  if (cache.has(url)) return cache.get(url) as Promise<T>
  const p = (chain = chain.then(() => new Promise((r) => setTimeout(r, 220)))).then(async () => {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`Shikimori HTTP ${res.status}`)
    return res.json() as Promise<T>
  })
  p.catch(() => cache.delete(url))
  cache.set(url, p)
  return p
}

export interface ShikiListParams {
  page?: number
  limit?: number
  order?: string
  kind?: string
  status?: string
  season?: string
  search?: string
}

export const shiki = {
  list: (p: ShikiListParams) =>
    get<ShikiAnime[]>('animes', {
      page: p.page ?? 1,
      limit: p.limit ?? 30,
      order: p.order ?? 'popularity',
      kind: p.kind ?? '!music,!special,!tv_special',
      status: p.status,
      season: p.season,
      search: p.search,
      censored: 'true',
    }),
  anime: (id: number | string) => get<ShikiAnime>(`animes/${id}`),
}

export const shikiTitle = (a: Pick<ShikiAnime, 'russian' | 'name'>) => a.russian || a.name

/** strips Shikimori bbcode like [character=1]Name[/character] */
export const stripBB = (s?: string | null) =>
  (s ?? '')
    .replace(/\[\/?[a-z_]+(=[^\]]*)?\]/gi, '')
    .replace(/\s*\[[^\]]*[぀-ヿ一-龯][^\]]*\]/g, '') // japanese names in brackets
    .trim()

/** Kodik/Shikimori titles live next to AniLibria ones under a negative id */
export const shikiReleaseId = (shikiId: number) => -shikiId

/** adapts a Shikimori entry to the Release shape so collection/history code works unchanged */
export function shikiToRelease(a: ShikiAnime): Release {
  const poster = shImg(a.image.original)
  return {
    id: shikiReleaseId(a.id),
    type: a.kind ? { value: a.kind, description: KINDS[a.kind] ?? a.kind } : null,
    year: a.aired_on ? Number(a.aired_on.slice(0, 4)) : 0,
    name: { main: shikiTitle(a), english: a.name, alternative: null },
    alias: `shiki-${a.id}`,
    season: null,
    mal: { id: a.id, rating: Number(a.score) || null },
    poster: { src: poster, preview: poster, thumbnail: shImg(a.image.preview) },
    fresh_at: '',
    is_ongoing: a.status === 'ongoing',
    description: stripBB(a.description),
    episodes_total: a.episodes || a.episodes_aired || null,
    average_duration_of_episode: a.duration ?? null,
    genres: a.genres?.map((g) => ({ id: g.id, name: g.russian })),
  }
}
