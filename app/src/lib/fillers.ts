// Filler and recap episodes of long shows (Bleach, Naruto, One Piece…), as MyAnimeList marks them: through
// Jikan's open API, or — where Jikan can't be reached — from MAL's own episode pages, read by the desktop
// app's main process or the tablet's native layer (a web page can't read them: MAL sends no CORS header).
// The answer is kept on the device for a week, so a title's episode list asks at most once.
import { useEffect, useState } from 'react'
import { CapacitorHttp } from '@capacitor/core'
import { isNative } from './platform'

export type EpisodeKind = 'filler' | 'recap'
export type FillerMap = Record<number, EpisodeKind>

const TTL = 7 * 86_400_000
const key = (malId: number) => `fillers:v1:${malId}`

function cached(malId: number): FillerMap | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(malId)) ?? 'null') as { at: number; f: number[]; r: number[] } | null
    if (!v || Date.now() - v.at > TTL) return null
    const m: FillerMap = {}
    for (const n of v.f) m[n] = 'filler'
    for (const n of v.r) m[n] = 'recap'
    return m
  } catch {
    return null
  }
}

function store(malId: number, m: FillerMap) {
  const f: number[] = []
  const r: number[] = []
  for (const [n, k] of Object.entries(m)) (k === 'filler' ? f : r).push(Number(n))
  try {
    localStorage.setItem(key(malId), JSON.stringify({ at: Date.now(), f, r }))
  } catch {
    /* storage full: asked again next time */
  }
}

// Jikan allows a few requests a second: pages are asked one after another
let queue: Promise<unknown> = Promise.resolve()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
function jikan<T>(path: string): Promise<T> {
  const run = queue.then(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://api.jikan.moe/v4${path}`, { signal: AbortSignal.timeout(8000) })
      if (res.status === 429 && attempt < 3) {
        await wait(1200 * (attempt + 1))
        continue
      }
      if (!res.ok) throw new Error(`Jikan ${res.status}`)
      await wait(350)
      return (await res.json()) as T
    }
  })
  queue = run.catch(() => {})
  return run
}

const pending = new Map<number, Promise<FillerMap>>()

async function viaJikan(malId: number): Promise<FillerMap> {
  const m: FillerMap = {}
  // a 1000-episode show is 10 pages; more than that is not worth the wait
  for (let page = 1; page <= 12; page++) {
    const d = await jikan<{ pagination: { has_next_page: boolean }; data: { mal_id: number; filler: boolean; recap: boolean }[] }>(`/anime/${malId}/episodes?page=${page}`)
    for (const e of d.data) {
      if (e.filler) m[e.mal_id] = 'filler'
      else if (e.recap) m[e.mal_id] = 'recap'
    }
    if (!d.pagination.has_next_page) break
  }
  return m
}

/** a MAL page's HTML where the platform can read it, null in a plain browser */
async function malText(url: string): Promise<string | null> {
  const bridge = window.aniplayer?.fetchText
  if (bridge) return bridge(url)
  if (isNative) {
    const r = await CapacitorHttp.get({ url, responseType: 'text' })
    if (r.status >= 400) throw new Error(`MAL ${r.status}`)
    return String(r.data)
  }
  return null
}

/** MAL's episode list, 100 a page: each row has its number and, for fillers and recaps, a tag */
async function viaMal(malId: number): Promise<FillerMap | null> {
  const m: FillerMap = {}
  for (let offset = 0; offset < 1200; offset += 100) {
    const html = await malText(`https://myanimelist.net/anime/${malId}/_/episode?offset=${offset}`)
    if (html == null) return null
    const rows = html.split('episode-list-data').slice(1)
    for (const row of rows) {
      const n = Number(/data-raw="(\d+)"/.exec(row)?.[1])
      const tag = /icon-episode-type-bg">\s*(Filler|Recap)/.exec(row)?.[1]
      if (n && tag) m[n] = tag === 'Filler' ? 'filler' : 'recap'
    }
    if (rows.length < 100) break
    await wait(600)
  }
  return m
}

/** which episodes of the title are fillers or recaps; empty when MAL marks none */
export function fillersOf(malId: number): Promise<FillerMap> {
  const c = cached(malId)
  if (c) return Promise.resolve(c)
  let p = pending.get(malId)
  if (!p) {
    p = (async () => {
      let m: FillerMap | null
      try {
        m = await viaJikan(malId)
      } catch {
        m = await viaMal(malId)
      }
      if (!m) throw new Error('no filler source here')
      store(malId, m)
      return m
    })().finally(() => pending.delete(malId))
    pending.set(malId, p)
  }
  return p
}

/** the filler map of one or more titles (a season split into parts), filled in when it arrives */
export function useFillers(malIds: (number | null | undefined)[]): Record<number, FillerMap> {
  const ids = [...new Set(malIds.filter((x): x is number => !!x && x > 0))]
  const k = ids.join(',')
  const [maps, setMaps] = useState<Record<number, FillerMap>>(() => Object.fromEntries(ids.map((id) => [id, cached(id)]).filter(([, m]) => m)))
  useEffect(() => {
    let on = true
    for (const id of ids)
      fillersOf(id)
        .then((m) => on && setMaps((s) => (s[id] === m ? s : { ...s, [id]: m })))
        .catch(() => {})
    return () => {
      on = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k])
  return maps
}

/** the next episode to play after `idx`, passing over fillers (and recaps) when the user asked to */
export function nextSkipping<T extends { ordinal: number }>(episodes: T[], idx: number, map: FillerMap | undefined, skip: boolean): { next: T | undefined; skipped: number } {
  let i = idx + 1
  if (skip && map) while (i < episodes.length && map[Math.floor(episodes[i].ordinal)]) i++
  // nothing but fillers to the end: the plain next one
  if (i >= episodes.length) return { next: episodes[idx + 1], skipped: 0 }
  return { next: episodes[i], skipped: i - idx - 1 }
}

export const KIND_LABEL: Record<EpisodeKind, string> = { filler: 'Филлер', recap: 'Рекап' }
