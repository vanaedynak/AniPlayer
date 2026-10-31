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
      // R+ titles (ecchi) stay, only hentai is hidden; censored=true hid both
      censored: 'false',
      rating: '!rx',
    }),
  /** search that forgives е/э: Shikimori spells Japanese names «Такаминэ», people type «Такамине» */
  search: async (query: string, limit = 30, kind = '!music') => {
    const run = (q: string) => shiki.list({ search: q, limit, order: 'popularity', kind }).catch(() => [] as ShikiAnime[])
    const q = query.trim().replace(/ё/gi, 'е')
    if (!/[а-я]/i.test(q)) return run(q)
    const toE = (w: string) => w.replace(/(?<=[а-я])е/gi, (c) => (c === 'Е' ? 'Э' : 'э'))
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
    // the whole phrase, the phrase with э, and the Japanese-looking words alone («такамине» → «такаминэ»)
    const named = words.filter((w) => w.length >= 4 && /(?<=[а-я])е/.test(w)).sort((a, b) => b.length - a.length).slice(0, 2)
    const tries = [...new Set([q, toE(q), ...named.map(toE)])]
    const lists = await Promise.all(tries.map(run))
    // titles containing more of the typed words go first; е and э count as one letter
    const n = (s: string) => s.toLowerCase().replace(/[ёэ]/g, 'е')
    const stems = words.map((w) => n(w).slice(0, Math.max(3, w.length - 2)))
    const score = (a: ShikiAnime) => stems.filter((st) => n(`${a.russian} ${a.name}`).includes(st)).length
    const seen = new Set<number>()
    const all = lists.flat().filter((a) => !seen.has(a.id) && !!seen.add(a.id))
    return all
      .map((a, i) => ({ a, i, s: score(a) }))
      .sort((x, y) => y.s - x.s || x.i - y.i)
      .map((x) => x.a)
      .slice(0, limit)
  },
  anime: (id: number | string) => get<ShikiAnime>(`animes/${id}`),
  franchise: (id: number | string) => get<ShikiFranchiseGraph>(`animes/${id}/franchise`),
  /** full entries for up to 50 ids in one call */
  byIds: (ids: number[]) => get<ShikiAnime[]>('animes', { ids: ids.join(','), limit: 50, censored: 'false' }),
}

export interface ShikiFranchiseGraph {
  current_id: number
  nodes: { id: number; date: number; name: string; kind: string; year: number }[]
  links: { source_id: number; target_id: number; relation: string }[]
}

export interface FranchisePart {
  a: ShikiAnime
  /** "Сезон 2 · Часть 3" for the main saga, kind + year for the rest */
  label: string
  main: boolean
}

const NOISE = /клип|проморолик|реклама|cm|pv|music/i

/** every TV season, film and OVA of a franchise in airing order, seasons split into parts by title */
export async function franchiseParts(id: number): Promise<FranchisePart[]> {
  const g = await shiki.franchise(id)
  const ids = g.nodes.filter((n) => !NOISE.test(n.kind)).map((n) => n.id)
  if (ids.length < 2) return []
  const chunks: number[][] = []
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50))
  const all = (await Promise.all(chunks.map(shiki.byIds))).flat().filter((a) => a.kind !== 'music')
  const date = (a: ShikiAnime) => a.aired_on ?? '9999'
  all.sort((x, y) => date(x).localeCompare(date(y)) || x.id - y.id)

  // the main saga: TV series chained by sequel/prequel, starting from this title (or the biggest chain).
  // Spin-offs and crossovers stay with the extras.
  const tv = all.filter((a) => a.kind === 'tv')
  const tvIds = new Set(tv.map((a) => a.id))
  const next = new Map<number, number[]>()
  for (const l of g.links)
    if ((l.relation === 'sequel' || l.relation === 'prequel') && tvIds.has(l.source_id) && tvIds.has(l.target_id)) {
      next.set(l.source_id, [...(next.get(l.source_id) ?? []), l.target_id])
      next.set(l.target_id, [...(next.get(l.target_id) ?? []), l.source_id])
    }
  const chainOf = (start: number) => {
    const seen = new Set([start])
    const queue = [start]
    while (queue.length) for (const n of next.get(queue.shift()!) ?? []) if (!seen.has(n)) seen.add(n) && queue.push(n)
    return seen
  }
  const episodes = (ids: Set<number>) => tv.reduce((sum, a) => sum + (ids.has(a.id) ? a.episodes || a.episodes_aired || 1 : 0), 0)
  let saga = tvIds.has(id) ? chainOf(id) : new Set<number>()
  if (!saga.size) for (const a of tv) {
    const c = chainOf(a.id)
    if (episodes(c) > episodes(saga)) saga = c
  }

  // a season whose title continues the previous one ("X — Прощание", "X. Часть 2") is a part of it
  const continues = (t: string, base: string) => t.startsWith(base + ' — ') || t.startsWith(base + '. ')
  let season = 0
  let base = ''
  let part = 1
  const parts: FranchisePart[] = []
  for (const a of all) {
    if (saga.has(a.id)) {
      const t = shikiTitle(a)
      if (base && continues(t, base)) part++
      else {
        season++
        part = 1
        base = t
      }
      const split = part > 1 || all.some((o) => o !== a && saga.has(o.id) && continues(shikiTitle(o), t))
      parts.push({ a, label: `Сезон ${season}${split ? ` · Часть ${part}` : ''}`, main: true })
    } else parts.push({ a, label: [KINDS[a.kind ?? ''] ?? a.kind, a.aired_on?.slice(0, 4)].filter(Boolean).join(' · '), main: false })
  }
  return parts
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
