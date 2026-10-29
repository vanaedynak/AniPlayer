// MAL id → AniLibria release, built from the AniLibria catalog once a day.
// Lets the full Shikimori catalog mark (and route to) titles AniLibria has voiced.
import { create } from 'zustand'

const KEY = 'aniplayer-libria-index'
const TTL = 24 * 3600_000
const API = 'https://anilibria.top/api/v1/anime/catalog/releases'

type Entry = { id: number; alias: string }
type Page = { data: { id: number; alias: string; mal: { id: number | null } | null }[]; meta: { pagination: { total_pages: number } } }

export const useLibriaIndex = create<{ byMal: Record<number, Entry>; ready: boolean }>(() => ({ byMal: {}, ready: false }))

let started = false

export function initLibriaIndex() {
  if (started) return
  started = true
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw) as { at: number; byMal: Record<number, Entry> }
      useLibriaIndex.setState({ byMal: saved.byMal, ready: true })
      if (Date.now() - saved.at < TTL) return
    }
  } catch {
    /* rebuild */
  }
  void build()
}

async function page(n: number): Promise<Page> {
  const res = await fetch(`${API}?page=${n}&limit=50&include=id,alias,mal`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function build() {
  try {
    const first = await page(1)
    const pages = [first]
    const total = first.meta.pagination.total_pages
    for (let n = 2; n <= total; n += 4) {
      const batch = await Promise.all([n, n + 1, n + 2, n + 3].filter((x) => x <= total).map(page))
      pages.push(...batch)
    }
    const byMal: Record<number, Entry> = {}
    for (const p of pages) for (const r of p.data) if (r.mal?.id) byMal[r.mal.id] = { id: r.id, alias: r.alias }
    useLibriaIndex.setState({ byMal, ready: true })
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), byMal }))
  } catch (e) {
    console.warn('[libria-index]', e)
    useLibriaIndex.setState({ ready: true })
  }
}
