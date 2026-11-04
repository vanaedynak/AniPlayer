import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Sparkles, Loader2, Star, RotateCcw, Search as SearchIcon, KeyRound } from 'lucide-react'
import { aiSearch, aiHistory, cachedAiSearch, hasGeminiKey, type AiResult } from '../lib/aiSearch'
import { useLibriaIndex } from '../lib/libriaIndex'
import { KINDS } from '../lib/shikimori'
import { useManga } from '../manga/store'
import { TranslatorSetup } from '../manga/Reader'

const EXAMPLES = [
  'Главный герой скрывает свою силу в магической академии, но не гарем',
  'Уютная повседневность про еду и путешествия',
  'Мрачный психологический триллер с неожиданными поворотами',
  'Спортивное аниме, после которого хочется тренироваться',
  'Романтика со взрослыми героями, без школы',
]

/** «Умный поиск»: describe what you feel like watching, Gemini picks from the real catalog */
export default function AiSearch() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''
  const [text, setText] = useState(q)
  const [res, setRes] = useState<AiResult | null>(() => (q ? cachedAiSearch(q) : null))
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [err, setErr] = useState('')
  const prefs = useManga((s) => s.prefs)
  const setPrefs = useManga((s) => s.setPrefs)
  const keyed = prefs.geminiKeys.some((k) => k.trim())
  const [history, setHistory] = useState(aiHistory)

  const run = (query: string, fresh = false) => {
    if (!query.trim() || !hasGeminiKey()) return
    setErr('')
    setBusy(true)
    setStep('Разбираю запрос…')
    // the second step starts after the first answer; a rough hint of where it is
    const t = setTimeout(() => setStep('Подбираю из каталога Shikimori…'), 3500)
    aiSearch(query, fresh)
      .then((r) => {
        setRes(r)
        setHistory(aiHistory())
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => {
        clearTimeout(t)
        setBusy(false)
      })
  }

  useEffect(() => {
    setText(q)
    if (!q) return setRes(null)
    const hit = cachedAiSearch(q)
    if (hit) setRes(hit)
    else run(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, keyed])

  const submit = (query: string) => {
    const v = query.trim()
    if (!v) return
    if (v === q) run(v)
    else setSp({ q: v })
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Sparkles className="text-accent-2" /> Умный поиск
        </h1>
        <p className="mt-1 text-muted">Опишите своими словами, что хочется посмотреть, — нейросеть подберёт аниме из настоящего каталога.</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(text)
        }}
        className="flex flex-col gap-3 rounded-[28px] bg-card/80 p-4 ring-1 ring-white/5 sm:flex-row"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit(text)
            }
          }}
          rows={2}
          placeholder="Хочу аниме, где главный герой скрывает свою силу в магической академии, но не гарем"
          className="min-h-[56px] flex-1 resize-none rounded-2xl bg-white/[0.05] px-4 py-3 text-[15px] font-semibold ring-1 ring-white/10 outline-none placeholder:text-muted focus:ring-accent"
        />
        <button type="submit" disabled={busy || !text.trim() || !keyed} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-white px-6 font-extrabold text-black disabled:opacity-50 sm:self-stretch sm:h-auto">
          {busy ? <Loader2 className="animate-spin" size={18} /> : <SearchIcon size={18} />} Подобрать
        </button>
      </form>

      {!keyed && (
        <div className="flex flex-col gap-3 rounded-[28px] bg-card/80 p-5 ring-1 ring-white/5">
          <div className="flex items-center gap-2 font-extrabold">
            <KeyRound size={18} className="text-accent-2" /> Нужен бесплатный ключ Gemini
          </div>
          <div className="text-sm text-muted">Тот же, что у переводчика манги. Хранится только на этом устройстве; один поиск — два коротких запроса, ответы запоминаются.</div>
          <TranslatorSetup prefs={prefs} set={setPrefs} book />
        </div>
      )}

      {keyed && !q && !busy && (
        <div className="flex flex-col gap-3">
          <div className="text-sm font-bold text-muted">Например:</div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <button key={e} onClick={() => submit(e)} className="rounded-full bg-white/[0.05] px-4 py-2 text-left text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10">
                {e}
              </button>
            ))}
          </div>
          {history.length > 0 && (
            <>
              <div className="mt-2 text-sm font-bold text-muted">Вы уже искали (сохранено, без новых запросов):</div>
              <div className="flex flex-wrap gap-2">
                {history.map((h) => (
                  <button key={h} onClick={() => submit(h)} className="rounded-full bg-accent/10 px-4 py-2 text-left text-sm font-semibold ring-1 ring-accent/25 hover:bg-accent/20">
                    {h}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {busy && (
        <div className="flex items-center justify-center gap-3 rounded-[28px] bg-card/60 py-14 font-bold text-muted ring-1 ring-white/5">
          <Loader2 className="animate-spin text-accent-2" /> {step}
        </div>
      )}
      {err && !busy && <div className="rounded-2xl bg-rose-500/10 p-4 text-sm font-semibold text-rose-300 ring-1 ring-rose-500/20">{err}</div>}

      {res && !busy && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted">
              <span className="font-bold text-white/80">Понял так:</span> {res.understood}
            </div>
            <button onClick={() => run(q, true)} className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-4 py-2 text-sm font-bold ring-1 ring-white/10 hover:bg-white/10" title="Спросить нейросеть заново">
              <RotateCcw size={14} /> Подобрать заново
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {res.picks.map(({ a, why }, i) => (
              <Pick key={a.id} a={a} why={why} n={i + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Pick({ a, why, n }: { a: AiResult['picks'][number]['a']; why: string; n: number }) {
  const l = useLibriaIndex((s) => s.byMal[a.id])
  const href = l ? `/title/${l.alias}` : `/anime/${a.id}`
  return (
    <Link to={href} className="animate-fade-up flex gap-4 rounded-3xl bg-card/80 p-3 ring-1 ring-white/5 transition hover:bg-card-2" style={{ animationDelay: `${n * 50}ms` }}>
      <img src={a.poster} alt="" className="h-36 w-24 shrink-0 rounded-2xl bg-card-2 object-cover" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1">
        <div className="flex items-start gap-2">
          <span className="text-lg font-extrabold text-accent-2">{n}.</span>
          <div className="min-w-0">
            <div className="line-clamp-2 text-lg leading-tight font-extrabold">{a.russian}</div>
            <div className="truncate text-xs text-muted">{a.name}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-white/60">
          {a.kind && <span>{KINDS[a.kind] ?? a.kind}</span>}
          {a.year && <span>{a.year}</span>}
          {a.score ? (
            <span className="flex items-center gap-0.5">
              <Star size={11} className="fill-yellow-400 text-yellow-400" /> {a.score}
            </span>
          ) : null}
          {l && <span className="rounded bg-white px-1.5 text-[10px] font-extrabold text-black">AniLibria</span>}
        </div>
        <div className="text-[11px] text-dim">{a.genres.slice(0, 5).join(' · ')}</div>
        <p className="mt-1 text-sm leading-snug text-white/85">{why}</p>
      </div>
    </Link>
  )
}
