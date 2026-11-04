// «Умный поиск»: an anime picked from a description in plain words («главный герой скрывает силу в
// магической академии, но не гарем»). Gemini alone forgets or invents titles, so it works in two steps:
//  1. it turns the wish into Shikimori filters (genres to have and to avoid, format, score) and a few
//     titles it thinks fit;
//  2. those filters and names become a pool of real titles with their descriptions, and Gemini picks
//     the best matches from that pool only, saying why in one sentence each.
// The answer is kept on the device for a month, so asking the same thing again costs no quota.
import { askGemini, DEFAULT_MODEL } from '../manga/translate'
import { useManga } from '../manga/store'
import { shiki } from './shikimori'

export interface AiAnime {
  id: number
  name: string
  russian: string
  score: number
  kind: string | null
  year: number | null
  poster: string
  genres: string[]
}
export interface AiResult {
  picks: { a: AiAnime; why: string }[]
  /** what the request was understood as, in Russian */
  understood: string
}

const HOST = 'https://shikimori.io'
const CACHE = 'aniplayer-ai-search'
const TTL = 30 * 86_400_000

const norm = (q: string) => q.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/[.!?]+$/, '')

function cacheGet(q: string): AiResult | null {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE) ?? '{}') as Record<string, { at: number; r: AiResult }>
    const hit = all[norm(q)]
    return hit && Date.now() - hit.at < TTL ? hit.r : null
  } catch {
    return null
  }
}
function cachePut(q: string, r: AiResult) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE) ?? '{}') as Record<string, { at: number; r: AiResult }>
    all[norm(q)] = { at: Date.now(), r }
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at)
    for (const k of keys.slice(60)) delete all[k]
    localStorage.setItem(CACHE, JSON.stringify(all))
  } catch {
    /* full: just not remembered */
  }
}
export const cachedAiSearch = cacheGet

/** earlier requests, newest first */
export function aiHistory(): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE) ?? '{}') as Record<string, { at: number }>
    return Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 8)
  } catch {
    return []
  }
}

interface Genre {
  id: number
  russian: string
  entry_type: string
}
let genres: Promise<Genre[]> | null = null
const animeGenres = () =>
  (genres ??= fetch(`${HOST}/api/genres`, { headers: { Accept: 'application/json' } })
    .then((r) => r.json() as Promise<Genre[]>)
    .then((l) => l.filter((g) => g.entry_type === 'Anime' && !/хентай|яой|эротика/i.test(g.russian)))
    .catch(() => {
      genres = null
      return []
    }))

const geminiOpts = () => {
  const { geminiKeys, geminiModel } = useManga.getState().prefs
  return { keys: geminiKeys, model: geminiModel || DEFAULT_MODEL }
}
export const hasGeminiKey = () => useManga.getState().prefs.geminiKeys.some((k) => k.trim())

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function askJson<T>(prompt: string, schema: object): Promise<T> {
  const json = await askGemini(
    { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json', responseSchema: schema } },
    geminiOpts(),
  )
  const text: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error('Нейросеть не ответила — попробуйте сформулировать иначе')
  return JSON.parse(text) as T
}

interface Plan {
  genres: number[]
  exclude: number[]
  kind: string
  min_score: number
  titles: string[]
  understood: string
}

/** step 2's pool: the most popular titles of each wanted genre without the unwanted ones, and the titles named */
async function pool(plan: Plan): Promise<number[]> {
  const ids = new Set<number>()
  const not = plan.exclude.map((g) => `!${g}`)
  const kind = plan.kind === 'movie' ? 'movie' : plan.kind === 'tv' ? 'tv' : 'tv,movie,ova,ona'
  const lists: Promise<{ id: number }[]>[] = []
  const params = (genre: string) => {
    const qs = new URLSearchParams({ order: 'popularity', limit: '50', kind, censored: 'false', rating: '!rx', genre })
    if (plan.min_score) qs.set('score', String(Math.min(8, plan.min_score)))
    return `${HOST}/api/animes?${qs}`
  }
  const get = (url: string) =>
    fetch(url, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<{ id: number }[]>) : []))
      .catch(() => [])
  // all wanted genres together, then each one alone (some old genre ids match nothing together)
  if (plan.genres.length > 1) lists.push(get(params([...plan.genres.map(String), ...not].join(','))))
  for (const g of plan.genres.slice(0, 3)) lists.push(get(params([String(g), ...not].join(','))))
  if (!plan.genres.length && not.length) lists.push(get(params(not.join(','))))
  for (const l of await Promise.all(lists)) for (const a of l) ids.add(a.id)
  // the titles Gemini thought of, found for real
  for (const t of plan.titles.slice(0, 8)) {
    const hit = (await shiki.search(t, 2).catch(() => []))[0]
    if (hit) ids.add(hit.id)
  }
  return [...ids].slice(0, 140)
}

interface GqlAnime {
  id: string
  name: string
  russian: string | null
  score: number
  kind: string | null
  airedOn: { year: number | null } | null
  poster: { mainUrl: string } | null
  genres: { russian: string }[]
  description: string | null
}

async function details(ids: number[]): Promise<(AiAnime & { desc: string })[]> {
  const out: (AiAnime & { desc: string })[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const res = await fetch(`${HOST}/api/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: `{ animes(ids: "${chunk.join(',')}", limit: 50, censored: false) { id name russian score kind airedOn { year } poster { mainUrl } genres { russian } description } }` }),
    })
    const json = (await res.json().catch(() => null)) as { data?: { animes: GqlAnime[] } } | null
    for (const a of json?.data?.animes ?? [])
      out.push({
        id: Number(a.id),
        name: a.name,
        russian: a.russian ?? a.name,
        score: a.score,
        kind: a.kind,
        year: a.airedOn?.year ?? null,
        poster: a.poster?.mainUrl ?? '',
        genres: a.genres.map((g) => g.russian),
        desc: (a.description ?? '')
          .replace(/\[[^\]]*\]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 260),
      })
  }
  return out
}

/** anime that fit the description; `fresh` asks again instead of using the remembered answer */
export async function aiSearch(query: string, fresh = false): Promise<AiResult> {
  if (!fresh) {
    const hit = cacheGet(query)
    if (hit) return hit
  }
  const gl = await animeGenres()
  const plan = await askJson<Plan>(
    `A viewer describes the anime they want (in Russian): "${query}"
Turn it into Shikimori catalog filters. Genres (id: name):
${gl.map((g) => `${g.id}: ${g.russian}`).join('\n')}
- genres: 1-3 ids that the anime should have (the most telling ones only)
- exclude: ids the viewer does NOT want (e.g. "не гарем" -> Гарем); empty if none
- kind: "tv", "movie" or "any"
- min_score: 0, or 7/8 if the viewer asks for good/top titles
- titles: up to 8 real anime (romaji or English names) that you are confident match the description
- understood: one short Russian sentence of what the viewer is looking for`,
    {
      type: 'OBJECT',
      properties: {
        genres: { type: 'ARRAY', items: { type: 'INTEGER' } },
        exclude: { type: 'ARRAY', items: { type: 'INTEGER' } },
        kind: { type: 'STRING' },
        min_score: { type: 'NUMBER' },
        titles: { type: 'ARRAY', items: { type: 'STRING' } },
        understood: { type: 'STRING' },
      },
      required: ['genres', 'exclude', 'kind', 'min_score', 'titles', 'understood'],
    },
  )
  const ids = await pool(plan)
  if (!ids.length) throw new Error('Под такое описание в каталоге ничего не нашлось — попробуйте шире')
  const cands = await details(ids)
  const byId = new Map(cands.map((c) => [c.id, c]))
  const picked = await askJson<{ picks: { id: number; why: string }[] }>(
    `A viewer wants (in Russian): "${query}"
Pick up to 8 anime from THIS LIST ONLY that match best, best first. Respect everything the viewer does not want.
Prefer the main TV series over recaps, specials and sequels unless asked otherwise.
For each give "why": one short Russian sentence on how it matches (no spoilers).
List (id | title | year | score | genres | description):
${cands.map((c) => `${c.id} | ${c.russian} / ${c.name} | ${c.year ?? '?'} | ${c.score || '?'} | ${c.genres.join(', ')} | ${c.desc}`).join('\n')}`,
    {
      type: 'OBJECT',
      properties: { picks: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, why: { type: 'STRING' } }, required: ['id', 'why'] } } },
      required: ['picks'],
    },
  )
  const picks = picked.picks
    .map((p) => {
      const c = byId.get(p.id)
      if (!c) return null
      const { desc: _desc, ...a } = c
      void _desc
      return { a, why: p.why }
    })
    .filter((p): p is { a: AiAnime; why: string } => !!p)
  if (!picks.length) throw new Error('Нейросеть не смогла выбрать — попробуйте описать иначе')
  const result = { picks, understood: plan.understood }
  cachePut(query, result)
  return result
}
