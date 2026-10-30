// YummyAnime open API: every dub of a title with embeddable player links and per-video op/ed timings.
// Reads need no key. Video still plays inside the original player (Kodik, Aksor, Alloha...).
import type { ShikiAnime } from './shikimori'

const HOST = 'https://api.yani.tv'

interface YSeg {
  time: number
  length: number
}
interface YVideo {
  video_id: number
  data: { player: string; dubbing: string; player_id: number }
  number: string
  iframe_url: string
  skips?: { opening: YSeg | null; ending: YSeg | null }
  index: number
}
interface YAnime {
  anime_id: number
  title: string
  poster?: { big?: string; fullsize?: string }
  remote_ids: { shikimori_id: number; myanimelist_id: number }
}

export type Seg = { start: number; stop: number }

export interface YEpisode {
  url: string
  player: string
  /** Kodik's player speaks a postMessage API, so progress and auto-skip work fully there */
  kodik: boolean
  op?: Seg
  ed?: Seg
}

export interface YDub {
  key: string
  title: string
  kind: 'voice' | 'dub' | 'subtitles'
  /** episode number -> one entry per player, Kodik first */
  episodes: Map<number, YEpisode[]>
  count: number
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(HOST + path)
  if (!res.ok) throw new Error(`YummyAnime HTTP ${res.status}`)
  const json = (await res.json()) as { response?: T; error?: string }
  if (json.error || json.response === undefined) throw new Error(json.error ?? 'YummyAnime: пустой ответ')
  return json.response
}

export interface YummyRef {
  id: number
  poster: string
}

const ID_KEY = 'aniplayer-yummy-refs' // shikimori id -> yummy anime, on this device
function savedIds(): Record<string, YummyRef> {
  try {
    return JSON.parse(localStorage.getItem(ID_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** YummyAnime has no lookup by Shikimori id: search by title and match remote ids */
export async function findYummy(a: Pick<ShikiAnime, 'id' | 'russian' | 'name'>): Promise<YummyRef | null> {
  const known = savedIds()[a.id]
  if (known) return known
  for (const q of [a.russian, a.name].filter(Boolean)) {
    const list = await get<YAnime[]>(`/search?q=${encodeURIComponent(q)}&limit=30`).catch(() => [] as YAnime[])
    const hit = list.find((x) => x.remote_ids?.shikimori_id === a.id || x.remote_ids?.myanimelist_id === a.id)
    if (hit) {
      const p = hit.poster?.big ?? hit.poster?.fullsize ?? ''
      const ref = { id: hit.anime_id, poster: p.startsWith('//') ? 'https:' + p : p }
      try {
        localStorage.setItem(ID_KEY, JSON.stringify({ ...savedIds(), [a.id]: ref }))
      } catch {
        /* ignore */
      }
      return ref
    }
  }
  return null
}

// dubs the user prefers, in order; everything else follows by episode count
const PREFERRED = [/studio\s*band/i, /anilibria/i, /anidub/i, /animevost/i, /dream\s*cast/i]
const PLAYERS = [/kodik/i, /aksor/i, /alloha/i]

const seg = (s?: YSeg | null): Seg | undefined => (s && s.length > 0 ? { start: s.time, stop: s.time + s.length } : undefined)

export async function yummyDubs(yummyId: number): Promise<YDub[]> {
  const videos = await get<YVideo[]>(`/anime/${yummyId}/videos`)
  const map = new Map<string, YDub>()
  for (const v of videos) {
    const n = Number(v.number)
    if (!Number.isFinite(n) || !v.iframe_url) continue
    const raw = v.data.dubbing.trim()
    const kind = /^субтитры/i.test(raw) ? 'subtitles' : /^дубляж/i.test(raw) ? 'dub' : 'voice'
    const title = raw.replace(/^(озвучка|дубляж|субтитры)\s*/i, '') || (kind === 'subtitles' ? 'Субтитры' : 'Без названия')
    const key = `${kind}:${title}`
    let d = map.get(key)
    if (!d) map.set(key, (d = { key, title, kind, episodes: new Map(), count: 0 }))
    const list = d.episodes.get(n) ?? []
    list.push({
      url: v.iframe_url.startsWith('//') ? 'https:' + v.iframe_url : v.iframe_url,
      player: v.data.player.replace(/^плеер\s*/i, ''),
      kodik: /kodik/i.test(v.data.player),
      op: seg(v.skips?.opening),
      ed: seg(v.skips?.ending),
    })
    d.episodes.set(n, list)
  }
  const prank = (p: string) => {
    const i = PLAYERS.findIndex((re) => re.test(p))
    return i < 0 ? 99 : i
  }
  for (const d of map.values()) {
    for (const list of d.episodes.values()) list.sort((a, b) => prank(a.player) - prank(b.player))
    d.count = d.episodes.size
  }
  const rank = (d: YDub) => {
    const i = PREFERRED.findIndex((re) => re.test(d.title))
    return (d.kind === 'subtitles' ? 1000 : 0) + (i < 0 ? 100 : i)
  }
  return [...map.values()].sort((a, b) => rank(a) - rank(b) || b.count - a.count)
}

export const dubLabel = (d: YDub) => (d.kind === 'dub' ? `${d.title} · дубляж` : d.title)
