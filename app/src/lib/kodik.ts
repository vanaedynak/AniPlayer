// Kodik: official API (needs a token issued by Kodik) + their embeddable player.
// Video plays inside Kodik's own iframe; we drive it through its postMessage API.
import { CapacitorHttp } from '@capacitor/core'
import { isElectron, isNative } from './platform'

const HOSTS = ['https://kodikapi.com', 'https://kodik-api.com']

export interface KodikResult {
  id: string
  type: string
  link: string
  title: string
  translation: { id: number; title: string; type: 'voice' | 'subtitles' }
  episodes_count?: number
  last_episode?: number
  last_season?: number
  seasons?: Record<string, { link: string; episodes?: Record<string, string> }>
}

export interface Dub {
  id: number
  title: string
  type: 'voice' | 'subtitles'
  episodes: number
  /** episode number → iframe link */
  links: Record<number, string>
  movieLink: string
}

/** requests that must skip browser CORS: Electron main process / native iOS HTTP */
async function nativeGetJson<T>(url: string): Promise<T> {
  if (isElectron && window.aniplayer?.fetchText) return JSON.parse(await window.aniplayer.fetchText(url))
  if (isNative) {
    const res = await CapacitorHttp.get({ url, responseType: 'json' })
    return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T
  }
  const res = await fetch(url)
  return res.json()
}

// dubs the user prefers, in order; everything else follows by episode count
const PREFERRED = [/studio\s*band/i, /anilibria/i, /anidub/i, /animevost/i, /dream\s*cast/i]

export async function kodikDubs(token: string, shikimoriId: number): Promise<Dub[]> {
  let data: { results?: KodikResult[]; error?: string } | null = null
  let lastErr: unknown
  for (const h of HOSTS) {
    try {
      data = await nativeGetJson(`${h}/search?token=${encodeURIComponent(token)}&shikimori_id=${shikimoriId}&with_episodes=true`)
      break
    } catch (e) {
      lastErr = e
    }
  }
  if (!data) throw lastErr
  if (data.error) throw new Error(data.error)

  const map = new Map<number, Dub>()
  for (const r of data.results ?? []) {
    const links: Record<number, string> = {}
    for (const season of Object.values(r.seasons ?? {}))
      for (const [n, link] of Object.entries(season.episodes ?? {})) links[Number(n)] = link
    const episodes = Math.max(r.last_episode ?? 0, r.episodes_count ?? 0, Object.keys(links).length, 1)
    const prev = map.get(r.translation.id)
    if (!prev || episodes > prev.episodes)
      map.set(r.translation.id, { id: r.translation.id, title: r.translation.title, type: r.translation.type, episodes, links, movieLink: r.link })
  }
  const rank = (d: Dub) => {
    const i = PREFERRED.findIndex((re) => re.test(d.title))
    return (d.type === 'subtitles' ? 1000 : 0) + (i < 0 ? 100 : i)
  }
  return [...map.values()].sort((a, b) => rank(a) - rank(b) || b.episodes - a.episodes)
}

export function kodikEpisodeUrl(d: Dub, episode: number) {
  const raw = d.links[episode] ?? d.movieLink
  const url = new URL(raw.startsWith('//') ? 'https:' + raw : raw)
  if (!d.links[episode] && d.episodes > 1) url.searchParams.set('episode', String(episode))
  url.searchParams.set('hide_selectors', 'true')
  return url.toString()
}

export function kodikCommand(frame: HTMLIFrameElement | null, method: string, extra: Record<string, unknown> = {}) {
  frame?.contentWindow?.postMessage({ key: 'kodik_player_api', value: { method, ...extra } }, '*')
}
