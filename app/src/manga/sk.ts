// Senkuro: a Russian manga site with a public GraphQL API made for reader apps (Tachiyomi / Mihon).
// Russian teams often publish only there, so its chapters fill the gaps MangaDex has in Russian.
import { CapacitorHttp } from '@capacitor/core'
import { isNative } from '../lib/platform'
import type { Chapter, Manga } from './md'

const API = 'https://api.senkuro.com/graphql'
// Senkuro sends no CORS headers: apps call it natively, Electron adds the header, dev goes through Vite
const ENDPOINT = import.meta.env.DEV ? '/senkuro/graphql' : API

const cache = new Map<string, Promise<unknown>>()

async function post<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  let json: { data?: T; errors?: { message: string }[] }
  if (isNative) {
    const res = await CapacitorHttp.post({ url: API, headers: { 'Content-Type': 'application/json' }, data: { query, variables } })
    if (res.status >= 400) throw new Error(`Senkuro HTTP ${res.status}`)
    json = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
  } else {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) })
    if (!res.ok) throw new Error(`Senkuro HTTP ${res.status}`)
    json = await res.json()
  }
  if (json.errors?.length || !json.data) throw new Error(json.errors?.[0]?.message ?? 'Senkuro: пустой ответ')
  return json.data
}

function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const key = query + JSON.stringify(variables)
  if (!cache.has(key)) {
    const p = post<T>(query, variables)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return cache.get(key) as Promise<T>
}

interface Name {
  lang: string
  content: string
}
interface SkHit {
  id: string
  slug: string
  originalName: Name | null
  titles: Name[]
  alternativeNames: Name[]
  cover: { original: { url: string } } | null
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const names = (h: Pick<SkHit, 'originalName' | 'titles'> & { alternativeNames?: Name[] }) =>
  [h.originalName?.content, ...h.titles.map((t) => t.content), ...(h.alternativeNames ?? []).map((t) => t.content)].filter(Boolean) as string[]
const title = (list: Name[], lang: string) => list.find((t) => t.lang === lang)?.content ?? ''

const KINDS: Record<string, string> = { MANHWA: 'ko', MANHUA: 'zh', MANGA: 'ja', OEL: 'en' }
const STATUSES: Record<string, string> = { ONGOING: 'ongoing', FINISHED: 'completed', HIATUS: 'hiatus', CANCELLED: 'cancelled', DISCONTINUED: 'cancelled' }
const RATINGS: Record<string, string> = { EXPLICIT: 'erotica', QUESTIONABLE: 'suggestive', SENSITIVE: 'suggestive', GENERAL: 'safe' }

function toManga(h: SkHit, extra: Partial<Manga> = {}): Manga {
  const all = names(h)
  const en = title(h.titles, 'EN')
  const original = h.originalName?.content ?? en
  return {
    id: `sk-${h.id}`,
    title: original,
    ruTitle: title(h.titles, 'RU'),
    altTitle: en && en !== original ? en : '',
    description: '',
    cover: h.cover?.original.url ?? '',
    status: '',
    year: null,
    tags: [],
    rating: 'safe',
    lang: 'ja',
    langs: ['ru'],
    mal: null,
    authors: [],
    demographic: null,
    lastChapter: null,
    names: all,
    sk: h.id,
    ...extra,
  }
}

const HIT = 'id slug originalName{lang content} titles{lang content} alternativeNames{lang content} cover{original{url}}'

export async function skSearch(q: string): Promise<SkHit[]> {
  const r = await gql<{ mangaTachiyomiSearch: { mangas: SkHit[] } }>(`query($q:String){ mangaTachiyomiSearch(query:$q){ mangas { ${HIT} } } }`, { q })
  return r.mangaTachiyomiSearch.mangas
}

/** Senkuro titles for a search, as catalog cards */
export async function skSearchManga(q: string) {
  return (await skSearch(q)).map((h) => toManga(h))
}

/** the Senkuro copy of a MangaDex title, matched by any of its names */
export async function skFind(list: string[]): Promise<string | null> {
  const wanted = new Set(list.map(norm).filter((n) => n.length > 2))
  for (const q of [...new Set(list)].slice(0, 2)) {
    const hits = await skSearch(q).catch(() => [])
    const hit = hits.find((h) => names(h).some((n) => wanted.has(norm(n))))
    if (hit) return hit.id
  }
  return null
}

export async function skManga(id: string): Promise<Manga> {
  const r = await gql<{
    mangaTachiyomiInfo: SkHit & { status: string; type: string; rating: string; localizations: { lang: string; description: string | null }[] }
  }>(
    `query($m:ID!){ mangaTachiyomiInfo(mangaId:$m){ id slug originalName{lang content} titles{lang content} alternativeNames{lang content} cover{original{url}} status type rating localizations{lang description} } }`,
    { m: id },
  )
  const i = r.mangaTachiyomiInfo
  return toManga(i, {
    status: STATUSES[i.status] ?? '',
    lang: KINDS[i.type] ?? 'ja',
    rating: RATINGS[i.rating] ?? 'safe',
    description: (i.localizations.find((l) => l.lang === 'RU')?.description ?? '').replace(/\s*©\s*Senkuro\s*$/, ''),
  })
}

export async function skChapters(id: string): Promise<Chapter[]> {
  const r = await gql<{
    mangaTachiyomiChapters: {
      chapters: { id: string; name: string | null; number: string; volume: string | null; teamIds: string[]; createdAt: string }[]
      teams: { id: string; name: string }[]
    }
  }>(`query($m:ID!){ mangaTachiyomiChapters(mangaId:$m){ chapters { id name number volume teamIds createdAt } teams { id name } } }`, { m: id })
  const teams = new Map(r.mangaTachiyomiChapters.teams.map((t) => [t.id, t.name]))
  return r.mangaTachiyomiChapters.chapters.map((c) => ({
    id: `sk:${id}:${c.id}`,
    num: c.number,
    volume: c.volume || null,
    title: c.name ?? '',
    pages: 0,
    lang: 'ru',
    group: c.teamIds.map((t) => teams.get(t)).filter(Boolean).join(', ') || 'Senkuro',
    external: null,
    at: Date.parse(c.createdAt),
  }))
}

export async function skPages(chapterId: string) {
  const [, manga, chapter] = chapterId.split(':')
  const r = await gql<{ mangaTachiyomiChapterPages: { pages: { url: string }[] } }>(
    `query($m:ID!,$c:ID!){ mangaTachiyomiChapterPages(mangaId:$m, chapterId:$c){ pages { url } } }`,
    { m: manga, c: chapter },
  )
  const urls = r.mangaTachiyomiChapterPages.pages.map((p) => p.url)
  return { urls, fallback: urls }
}

export { norm as skNorm }
