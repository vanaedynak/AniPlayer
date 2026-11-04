import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, BookText, Loader2, Sparkles } from 'lucide-react'
import { Section } from './ui'
import { useAsync } from '../lib/useAsync'
import { shImg } from '../lib/shikimori'
import { search as mdSearch } from '../manga/md'
import { askGemini, DEFAULT_MODEL } from '../manga/translate'
import { useManga } from '../manga/store'
import { SOURCES } from '../ranobe/registry'
import { novelPath } from '../ranobe/shelf'

interface Related {
  relation: string
  manga: { id: number; name: string; russian: string; image?: { preview?: string }; kind: string; volumes: number; chapters: number } | null
}

const NOVEL = /novel/
/** «Читать мангу / манхву …» */
const READ_KIND: Record<string, string> = { manga: 'мангу', manhwa: 'манхву', manhua: 'маньхуа', one_shot: 'ваншот' }
const KIND: Record<string, string> = { manga: 'Манга', manhwa: 'Манхва', manhua: 'Маньхуа', light_novel: 'Ранобэ', novel: 'Новелла', one_shot: 'Ваншот' }

/** where the source is readable here: the MangaDex title with the same MAL id, or ranobe found by name */
async function findHere(m: NonNullable<Related['manga']>): Promise<{ to: string; where: string }[]> {
  // long names with a subtitle find nothing: the part before the colon goes next
  const short = (t: string) => t.split(/[:：]/)[0].trim()
  const names = (...l: string[]) => [...new Set(l.filter(Boolean).flatMap((t) => [t, short(t)]))]
  if (NOVEL.test(m.kind)) {
    const out: { to: string; where: string }[] = []
    for (const s of SOURCES) {
      for (const q of s.lang === 'ru' ? names(m.russian, m.name) : names(m.name)) {
        const hits = await s.search(q).catch(() => [])
        if (hits[0]) {
          out.push({ to: novelPath(s.id, hits[0].id), where: s.name })
          break
        }
      }
    }
    return out
  }
  for (const q of names(m.name, m.russian)) {
    const r = await mdSearch(q).catch(() => null)
    const hit = r?.items.find((x) => x.mal === m.id)
    if (hit) return [{ to: `/manga/${hit.id}`, where: 'MangaDex' }]
  }
  return []
}

interface Point {
  chapter: number | null
  volume: number | null
  note: string
}

/** where the anime leaves the source off, by Gemini with Google search (an estimate: no open database has it) */
async function wherePoint(anime: string, episodes: number | null, src: NonNullable<Related['manga']>): Promise<Point> {
  const key = `aniplayer-continue-${anime}-${src.id}`
  const hit = localStorage.getItem(key)
  if (hit) return JSON.parse(hit) as Point
  const { geminiKeys, geminiModel } = useManga.getState().prefs
  const kind = NOVEL.test(src.kind) ? 'light novel' : 'manga'
  const prompt = `The anime "${anime}"${episodes ? ` (${episodes} episodes)` : ''} adapts the ${kind} "${src.name}".
Where in the ${kind} does this anime end? Give the chapter (and volume) a viewer who finished this anime should start reading from.
Check it with a search. Reply with only JSON, no other text:
{"chapter": number or null, "volume": number or null, "note": "one short sentence in Russian, e.g. which arc the anime ends on"}`
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }
  const opts = { keys: geminiKeys, model: geminiModel || DEFAULT_MODEL }
  // with Google search when the model allows it, plain otherwise
  const json = await askGemini({ ...body, tools: [{ google_search: {} }] }, opts).catch(() => askGemini(body, opts))
  const text: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  const raw = text.match(/\{[\s\S]*\}/)?.[0]
  if (!raw) throw new Error('Нейросеть не ответила')
  const p = JSON.parse(raw) as Point
  const out = { chapter: Number(p.chapter) || null, volume: Number(p.volume) || null, note: String(p.note ?? '') }
  try {
    localStorage.setItem(key, JSON.stringify(out))
  } catch {
    /* ignore */
  }
  return out
}

/**
 * «Читать дальше»: the manga or ranobe this anime is made from, readable here, and — on request — the
 * chapter to pick it up from once the anime is over.
 */
const relatedCache = new Map<number, Promise<NonNullable<Related['manga']>[]>>()
/** the manga and ranobe the anime is made from, by its MAL id on Shikimori (asked once per page visit) */
function sourcesOf(malId: number) {
  let p = relatedCache.get(malId)
  if (!p) {
    p = fetch(`https://shikimori.io/api/animes/${malId}/related`, { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) return []
        const list = ((await res.json()) as Related[]).filter((r) => r.manga && (r.relation === 'Adaptation' || r.relation === 'Source'))
        return list.map((r) => r.manga!).slice(0, 3)
      })
      .catch(() => {
        relatedCache.delete(malId)
        return []
      })
    relatedCache.set(malId, p)
  }
  return p
}

const savedPoint = (anime: string, srcId: number): Point | null => {
  try {
    return JSON.parse(localStorage.getItem(`aniplayer-continue-${anime}-${srcId}`) ?? 'null') as Point | null
  } catch {
    return null
  }
}

/**
 * Next to the title's buttons: «Читать мангу-первоисточник» or «…ранобэ…», and once the chapter the anime
 * ends on is known, «Продолжить историю · гл. 89». It leads to the «Читать дальше» block below.
 */
export function SourceButton({ malId, title }: { malId: number; title: string }) {
  const src = useAsync(() => sourcesOf(malId), [malId])
  const m = src.data?.[0]
  if (!m) return null
  const novel = NOVEL.test(m.kind)
  const point = savedPoint(title, m.id)
  return (
    <button
      onClick={() => document.getElementById('read-on')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      title={m.russian || m.name}
      className="flex h-12 items-center gap-2 rounded-full bg-white/10 px-5 font-bold ring-1 ring-white/10 transition hover:bg-white/15"
    >
      {novel ? <BookText size={17} /> : <BookOpen size={17} />}
      {point?.chapter ? `Продолжить историю · гл. ${point.chapter}` : novel ? 'Читать ранобэ-первоисточник' : `Читать ${READ_KIND[m.kind] ?? 'мангу'}-первоисточник`}
    </button>
  )
}

export function ContinueReading({ malId, title, episodes }: { malId: number; title: string; episodes: number | null }) {
  const src = useAsync(() => sourcesOf(malId), [malId])
  if (!src.data?.length) return null
  return (
    <div id="read-on" className="scroll-mt-24">
    <Section
      title={
        <span className="flex items-center gap-2">
          <BookOpen size={20} className="text-accent-2" /> Читать дальше
        </span>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        {src.data.map((m) => (
          <SourceCard key={m.id} m={m} anime={title} episodes={episodes} />
        ))}
      </div>
    </Section>
    </div>
  )
}

function SourceCard({ m, anime, episodes }: { m: NonNullable<Related['manga']>; anime: string; episodes: number | null }) {
  const here = useAsync(() => findHere(m), [m.id])
  const hasKey = useManga((s) => s.prefs.geminiKeys.some((k) => k.trim()))
  // the answer is kept on the device: the button asks the network once per anime season
  const [point, setPoint] = useState<Point | null>(() => savedPoint(anime, m.id))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const novel = NOVEL.test(m.kind)
  const manga = !novel ? here.data?.[0] : undefined
  const ask = () => {
    setBusy(true)
    setErr('')
    wherePoint(anime, episodes, m)
      .then(setPoint)
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="flex gap-4 rounded-2xl bg-card/80 p-4 ring-1 ring-white/[0.04]">
      <img src={shImg(m.image?.preview)} alt="" className="h-28 w-20 shrink-0 rounded-xl bg-card-2 object-cover" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <div className="text-xs font-extrabold tracking-wide text-muted uppercase">{KIND[m.kind] ?? 'Первоисточник'}</div>
          <div className="line-clamp-2 font-extrabold">{m.russian || m.name}</div>
          <div className="text-xs text-dim">
            {[m.volumes ? `${m.volumes} т.` : '', m.chapters ? `${m.chapters} гл.` : ''].filter(Boolean).join(' · ')}
          </div>
        </div>
        {point && (
          <div className="rounded-xl bg-accent/15 px-3 py-2 text-sm">
            <div className="font-bold">
              {point.chapter ? `Продолжайте с ${point.volume ? `тома ${point.volume}, ` : ''}главы ${point.chapter}` : 'Точное место не нашлось'}
            </div>
            {point.note && <div className="text-xs text-white/70">{point.note}</div>}
            <div className="mt-0.5 text-[10px] text-white/40">По оценке нейросети с поиском в интернете — может ошибаться</div>
          </div>
        )}
        {err && <div className="text-xs text-rose-300">{err}</div>}
        <div className="mt-auto flex flex-wrap gap-2">
          {here.loading ? (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Loader2 size={13} className="animate-spin" /> Ищу здесь…
            </span>
          ) : manga ? (
            <Link to={point?.chapter ? `${manga.to}?ch=${point.chapter}` : manga.to} className="flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-bold text-black">
              <BookOpen size={15} /> {point?.chapter ? `Читать с главы ${point.chapter}` : 'Читать'}
            </Link>
          ) : novel && here.data?.length ? (
            here.data.map((h) => (
              <Link key={h.to} to={h.to} className="flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-bold text-black">
                <BookText size={15} /> {h.where}
              </Link>
            ))
          ) : (
            <span className="text-xs text-muted">Здесь не нашлась</span>
          )}
          {!point &&
            (hasKey ? (
              <button onClick={ask} disabled={busy} className="flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-bold hover:bg-white/15 disabled:opacity-60">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Продолжить историю после аниме
              </button>
            ) : (
              <span className="text-xs text-dim">С ключом Gemini (переводчик манги) подскажу, с какой главы продолжить после аниме</span>
            ))}
        </div>
      </div>
    </div>
  )
}
