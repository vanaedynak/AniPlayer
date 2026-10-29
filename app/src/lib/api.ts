// AniLibria public API v1 (https://anilibria.top/api/docs/v1)
const HOSTS = ['https://anilibria.top', 'https://aniliberty.top', 'https://api.anilibria.app']
let host = HOSTS[0]

export const img = (path?: string | null) => (path ? (path.startsWith('http') ? path : host + path) : '')

export interface ValueDesc { value: string; description: string }
export interface Poster {
  src: string
  preview: string
  thumbnail: string
  optimized?: { src: string; preview: string; thumbnail: string }
}
export interface Genre { id: number; name: string; total_releases?: number; image?: { preview: string; thumbnail: string; optimized?: { preview: string; thumbnail: string } } }
export interface Episode {
  id: string
  name: string | null
  ordinal: number
  opening?: { start: number | null; stop: number | null }
  ending?: { start: number | null; stop: number | null }
  preview?: Poster
  hls_480: string | null
  hls_720: string | null
  hls_1080: string | null
  duration: number | null
  sort_order: number
  release_id: number
  updated_at?: string
}
export interface Release {
  id: number
  type: ValueDesc | null
  year: number
  name: { main: string; english: string | null; alternative: string | null }
  alias: string
  season: ValueDesc | null
  mal?: { id: number | null; rating?: number | null } | null
  shikimori?: { id: number | null; rating?: number | null } | null
  poster: Poster
  fresh_at: string
  is_ongoing: boolean
  age_rating?: { label: string } | null
  publish_day?: ValueDesc | null
  description: string | null
  notification?: string | null
  episodes_total: number | null
  average_duration_of_episode: number | null
  added_in_users_favorites?: number
  is_blocked_by_geo?: boolean
  genres?: Genre[]
  latest_episode?: Episode | null
  episodes?: Episode[]
  members?: { id: string; nickname: string; role: ValueDesc }[]
  torrents?: unknown[]
}
export interface Paginated<T> {
  data: T[]
  meta: { pagination: { total: number; current_page: number; total_pages: number } }
}
export interface ScheduleItem { release: Release; full_season_is_released?: boolean; published_release_episode?: Episode | null; next_release_episode_number?: number | null }
export interface Franchise {
  id: string
  name: string
  name_english?: string
  first_year?: number
  last_year?: number
  total_releases?: number
  franchise_releases: { id: string; sort_order: number; release_id: number; release: Release }[]
}

const cache = new Map<string, { at: number; data: unknown }>()

async function get<T>(path: string, params?: Record<string, string | number | undefined>, ttl = 60_000): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') qs.append(k, String(v))
  const rel = `/api/v1/${path}${qs.size ? '?' + qs : ''}`
  const hit = cache.get(rel)
  if (hit && Date.now() - hit.at < ttl) return hit.data as T

  let lastErr: unknown
  // try the current mirror first, then the others (AniLibria rotates domains)
  for (const h of [host, ...HOSTS.filter((x) => x !== host)]) {
    try {
      const res = await fetch(h + rel, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as T
      host = h
      cache.set(rel, { at: Date.now(), data })
      return data
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

export const api = {
  latest: (limit = 24) => get<Release[]>('anime/releases/latest', { limit }),
  random: (limit = 10) => get<Release[]>('anime/releases/random', { limit }, 0),
  release: (idOrAlias: string | number) => get<Release>(`anime/releases/${idOrAlias}`, undefined, 5 * 60_000),
  search: (query: string) => get<Release[]>('app/search/releases', { query }),
  scheduleWeek: () => get<ScheduleItem[]>('anime/schedule/week', undefined, 10 * 60_000),
  franchiseOf: (releaseId: number) => get<Franchise[]>(`anime/franchises/release/${releaseId}`, undefined, 30 * 60_000),
  genres: () => get<Genre[]>('anime/genres', undefined, 60 * 60_000),
  years: () => get<number[]>('anime/catalog/references/years', undefined, 60 * 60_000),
  catalog: (p: CatalogParams) =>
    get<Paginated<Release>>('anime/catalog/releases', {
      page: p.page ?? 1,
      limit: p.limit ?? 30,
      'f[sorting]': p.sorting ?? 'FRESH_AT_DESC',
      'f[search]': p.search,
      'f[genres]': p.genres?.length ? p.genres.join(',') : undefined,
      'f[types][]': p.type,
      'f[seasons][]': p.season,
      'f[years][from_year]': p.yearFrom,
      'f[years][to_year]': p.yearTo,
      'f[publish_statuses][]': p.status,
    }),
}

export interface CatalogParams {
  page?: number
  limit?: number
  sorting?: string
  search?: string
  genres?: number[]
  type?: string
  season?: string
  yearFrom?: number
  yearTo?: number
  status?: string
}

export const SORTINGS = [
  { value: 'FRESH_AT_DESC', label: 'Недавно обновлённые' },
  { value: 'RATING_DESC', label: 'По рейтингу' },
  { value: 'YEAR_DESC', label: 'Сначала новые' },
  { value: 'YEAR_ASC', label: 'Сначала старые' },
]
export const TYPES = [
  { value: 'TV', label: 'ТВ' },
  { value: 'MOVIE', label: 'Фильм' },
  { value: 'ONA', label: 'ONA' },
  { value: 'OVA', label: 'OVA' },
  { value: 'SPECIAL', label: 'Спешл' },
  { value: 'WEB', label: 'WEB' },
]
export const SEASONS = [
  { value: 'winter', label: 'Зима' },
  { value: 'spring', label: 'Весна' },
  { value: 'summer', label: 'Лето' },
  { value: 'autumn', label: 'Осень' },
]

export function posterUrl(r: Pick<Release, 'poster'> | undefined, size: 'src' | 'thumbnail' = 'src') {
  if (!r?.poster) return ''
  return img(r.poster.optimized?.[size] ?? r.poster[size])
}

export function episodePreview(e: Episode | undefined | null) {
  if (!e?.preview) return ''
  return img(e.preview.optimized?.preview ?? e.preview.src)
}

export function sortedEpisodes(r: Release) {
  return [...(r.episodes ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.ordinal - b.ordinal)
}

// AniSkip: crowd-sourced opening/ending times keyed by MAL id + episode number
type Segment = { start: number; stop: number }
const skipCache = new Map<string, Promise<{ op?: Segment; ed?: Segment }>>()
export function aniskip(malId: number, episode: number, length = 0) {
  const key = `${malId}:${episode}`
  if (!skipCache.has(key)) {
    const url = `https://api.aniskip.com/v2/skip-times/${malId}/${episode}?types[]=op&types[]=ed&episodeLength=${Math.round(length)}`
    skipCache.set(
      key,
      fetch(url)
        .then((r) => r.json())
        .then((d: { found: boolean; results?: { skipType: string; interval: { startTime: number; endTime: number } }[] }) => {
          const out: { op?: Segment; ed?: Segment } = {}
          for (const r of d.results ?? []) {
            const seg = { start: r.interval.startTime, stop: r.interval.endTime }
            if (r.skipType === 'op') out.op = seg
            if (r.skipType === 'ed') out.ed = seg
          }
          return out
        })
        .catch(() => ({})),
    )
  }
  return skipCache.get(key)!
}
