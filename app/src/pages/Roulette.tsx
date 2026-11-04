// «Аниме-рулетка» as a gacha summon: a magic circle charges up, flashes, and the pulled anime come out as
// cards whose rarity is their score — SSR for the masterpieces, SR for the strong ones, R for the rest.
// The pool is either the user's own «В планах» list or all of Shikimori, narrowed by genre, kind, score and era.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Dices, Sparkles, Star, Play, RotateCcw, ListPlus } from 'lucide-react'
import { shImg, shikiTitle, KINDS, shiki, type ShikiAnime } from '../lib/shikimori'
import { useLibriaIndex } from '../lib/libriaIndex'
import { useStore } from '../lib/store'
import { cn } from '../lib/format'

type Pool = 'plans' | 'all'
type Rarity = 'SSR' | 'SR' | 'R'
type Phase = 'idle' | 'charge' | 'flash' | 'reveal'

const rarityOf = (score: number): Rarity => (score >= 8.5 ? 'SSR' : score >= 7.5 ? 'SR' : 'R')
const RARITY: Record<Rarity, { color: string; stars: number; glow: string }> = {
  SSR: { color: '#fbbf24', stars: 5, glow: 'conic-gradient(from 0deg, #f43f5e, #fbbf24, #4ade80, #38bdf8, #a78bfa, #f43f5e)' },
  SR: { color: '#c084fc', stars: 4, glow: 'linear-gradient(135deg, #a855f7, #ec4899)' },
  R: { color: '#60a5fa', stars: 3, glow: 'linear-gradient(135deg, #3b82f6, #06b6d4)' },
}

const KIND_OPTS = [
  { v: 'tv', l: 'Сериалы' },
  { v: 'movie', l: 'Фильмы' },
  { v: 'tv,movie,ova,ona', l: 'Всё' },
]
const SCORE_OPTS = [
  { v: 0, l: 'Любая' },
  { v: 7, l: '7+' },
  { v: 8, l: '8+' },
]
const ERA_OPTS = [
  { v: '', l: 'Любые' },
  { v: '1960_1999', l: 'До 2000' },
  { v: '2000_2014', l: '2000–2014' },
  { v: `2015_${new Date().getFullYear()}`, l: '2015+' },
]

interface Genre {
  id: number
  russian: string
  entry_type: string
}
let genresCache: Promise<Genre[]> | null = null
const animeGenres = () =>
  (genresCache ??= fetch('https://shikimori.io/api/genres', { headers: { Accept: 'application/json' } })
    .then((r) => r.json() as Promise<Genre[]>)
    .then((l) => l.filter((g) => g.entry_type === 'Anime' && !/хентай|яой|юри/i.test(g.russian)).sort((a, b) => a.russian.localeCompare(b.russian, 'ru')))
    .catch(() => {
      genresCache = null
      return []
    }))

/** random anime from Shikimori with the filters; never cached, every summon is a new roll */
async function rollShiki(n: number, f: { genre: number | null; kind: string; score: number; era: string }): Promise<ShikiAnime[]> {
  const qs = new URLSearchParams({ order: 'random', limit: String(n), kind: f.kind, censored: 'false', rating: '!rx', status: 'released,ongoing' })
  if (f.genre) qs.set('genre', String(f.genre))
  if (f.score) qs.set('score', String(f.score))
  if (f.era) qs.set('season', f.era)
  const res = await fetch(`https://shikimori.io/api/animes?${qs}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Shikimori не ответил (${res.status})`)
  return res.json()
}

const shuffle = <T,>(a: T[]) => {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

export default function Roulette() {
  const titles = useStore((s) => s.titles)
  const plans = useMemo(() => Object.values(titles).filter((t) => t.status === 'planned' && t.malId), [titles])
  const [pool, setPool] = useState<Pool>(plans.length ? 'plans' : 'all')
  const [genres, setGenres] = useState<Genre[]>([])
  const [genre, setGenre] = useState<number | null>(null)
  const [kind, setKind] = useState('tv')
  const [score, setScore] = useState(7)
  const [era, setEra] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<ShikiAnime[]>([])
  const [err, setErr] = useState('')
  const [shown, setShown] = useState(0)

  useEffect(() => {
    void animeGenres().then(setGenres)
  }, [])

  // cards turn over one after another
  useEffect(() => {
    if (phase !== 'reveal' || shown >= result.length) return
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 150 : 260)
    return () => clearTimeout(t)
  }, [phase, shown, result.length])

  const summon = async (n: number) => {
    if (phase === 'charge' || phase === 'flash') return
    setErr('')
    setPhase('charge')
    setShown(0)
    const started = Date.now()
    try {
      let got: ShikiAnime[]
      if (pool === 'plans') {
        if (!plans.length) throw new Error('В «В планах» пока пусто — добавьте туда аниме или призывайте из всего Shikimori')
        const ids = shuffle(plans.map((t) => t.malId!)).slice(0, n)
        const full = await shiki.byIds(ids)
        got = ids.map((id) => full.find((a) => a.id === id)).filter((a): a is ShikiAnime => !!a)
      } else {
        got = await rollShiki(n, { genre, kind, score, era })
      }
      if (!got.length) throw new Error('С такими условиями ничего не нашлось — ослабьте фильтры')
      // the circle charges at least this long, whatever the network does
      await new Promise((r) => setTimeout(r, Math.max(0, 1700 - (Date.now() - started))))
      setResult(got)
      setPhase('flash')
      setTimeout(() => setPhase('reveal'), 450)
    } catch (e) {
      setErr((e as Error).message)
      setPhase('idle')
    }
  }

  const best = result.reduce<Rarity>((r, a) => (rarityOf(Number(a.score)) === 'SSR' ? 'SSR' : r === 'SSR' ? r : rarityOf(Number(a.score)) === 'SR' ? 'SR' : r), 'R')
  const charging = phase === 'charge'

  return (
    <div className="flex flex-col gap-6">
      <style>{CSS}</style>
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Dices className="text-accent-2" /> Аниме-рулетка
        </h1>
        <p className="mt-1 text-muted">Призовите случайное аниме. Редкость карты — по оценке: SSR от 8.5, SR от 7.5.</p>
      </div>

      <div className="flex flex-col gap-4 rounded-[28px] bg-card/80 p-5 ring-1 ring-white/5">
        <div className="flex flex-wrap gap-2">
          <Chip on={pool === 'plans'} onClick={() => setPool('plans')}>
            Мои «В планах» · {plans.length}
          </Chip>
          <Chip on={pool === 'all'} onClick={() => setPool('all')}>
            Весь Shikimori
          </Chip>
        </div>
        {pool === 'all' && (
          <div className="flex flex-col gap-3">
            <Opt label="Жанр">
              <select
                value={genre ?? ''}
                onChange={(e) => setGenre(e.target.value ? Number(e.target.value) : null)}
                className="h-9 rounded-full bg-white/[0.06] px-4 text-sm font-bold ring-1 ring-white/10 outline-none"
              >
                <option value="">Любой</option>
                {genres.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.russian}
                  </option>
                ))}
              </select>
            </Opt>
            <Opt label="Формат">
              {KIND_OPTS.map((o) => (
                <Chip key={o.v} on={kind === o.v} onClick={() => setKind(o.v)} small>
                  {o.l}
                </Chip>
              ))}
            </Opt>
            <Opt label="Оценка">
              {SCORE_OPTS.map((o) => (
                <Chip key={o.v} on={score === o.v} onClick={() => setScore(o.v)} small>
                  {o.l}
                </Chip>
              ))}
            </Opt>
            <Opt label="Годы">
              {ERA_OPTS.map((o) => (
                <Chip key={o.v} on={era === o.v} onClick={() => setEra(o.v)} small>
                  {o.l}
                </Chip>
              ))}
            </Opt>
          </div>
        )}
      </div>

      {/* the summoning altar */}
      <div className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-[32px] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),transparent_70%)] ring-1 ring-white/5">
        {phase !== 'reveal' && (
          <div className={cn('gacha-circle relative h-64 w-64 sm:h-80 sm:w-80', charging && 'charging')}>
            <svg viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full overflow-visible">
              <defs>
                <path id="rune-ring" d="M 0 -78 A 78 78 0 1 1 -0.1 -78" />
              </defs>
              <g className="ring-a">
                <circle r="92" fill="none" stroke="var(--color-accent-2)" strokeWidth="1.4" opacity="0.8" />
                <circle r="86" fill="none" stroke="var(--color-accent-2)" strokeWidth="0.6" strokeDasharray="2 4" />
                <text fontSize="8.5" fill="var(--color-accent-2)" letterSpacing="3" opacity="0.85">
                  <textPath href="#rune-ring">ᚠᚢᚦᚨᚱᚲ ✦ 召喚 ✦ ᚷᚹᚺᚾᛁᛃ ✦ 運命 ✦ ᛇᛈᛉᛊᛏᛒ ✦ 星 ✦ ᛖᛗᛚᛜᛞᛟ ✦</textPath>
                </text>
              </g>
              <g className="ring-b">
                <polygon points={star(3, 66)} fill="none" stroke="var(--color-pink)" strokeWidth="1.2" />
                <polygon points={star(3, 66)} transform="rotate(60)" fill="none" stroke="var(--color-pink)" strokeWidth="1.2" />
                <circle r="66" fill="none" stroke="var(--color-pink)" strokeWidth="0.8" />
              </g>
              <g className="ring-c">
                <polygon points={star(5, 40, 2)} fill="none" stroke="var(--color-accent)" strokeWidth="1.4" />
                <circle r="40" fill="none" stroke="var(--color-accent)" strokeWidth="0.8" />
              </g>
              <circle r="14" className="core" fill="var(--color-accent-2)" />
            </svg>
            {charging && Array.from({ length: 14 }, (_, i) => <span key={i} className="mote" style={{ '--a': `${(i / 14) * 360}deg`, '--d': `${(i % 5) * 0.12}s` } as React.CSSProperties} />)}
          </div>
        )}
        {phase === 'flash' && <div className={cn('gacha-flash absolute inset-0', best === 'SSR' ? 'ssr' : best === 'SR' ? 'sr' : '')} />}

        {phase === 'reveal' && result.length === 1 && <BigCard a={result[0]} open={shown > 0} />}
        {phase === 'reveal' && result.length > 1 && (
          <div className="grid w-full grid-cols-2 gap-3 p-4 sm:grid-cols-5 sm:p-6">
            {result.map((a, i) => (
              <SmallCard key={a.id} a={a} open={i < shown} />
            ))}
          </div>
        )}

        {phase === 'idle' && <div className="absolute bottom-6 text-sm font-bold text-muted">Алтарь ждёт призыва…</div>}
        {charging && <div className="absolute bottom-6 animate-pulse text-sm font-extrabold tracking-[0.3em] text-accent-2 uppercase">Призыв…</div>}
      </div>

      {err && <div className="rounded-2xl bg-rose-500/10 p-4 text-sm font-semibold text-rose-300 ring-1 ring-rose-500/20">{err}</div>}

      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={() => summon(1)}
          disabled={charging || phase === 'flash'}
          className="flex h-14 items-center gap-2 rounded-full bg-white px-8 text-lg font-extrabold text-black shadow-[0_10px_40px_-10px_var(--color-glow)] transition hover:scale-[1.04] disabled:opacity-50"
        >
          {phase === 'reveal' ? <RotateCcw size={20} /> : <Sparkles size={20} />} Призыв ×1
        </button>
        <button
          onClick={() => summon(10)}
          disabled={charging || phase === 'flash'}
          className="flex h-14 items-center gap-2 rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-pink)] px-8 text-lg font-extrabold text-white transition hover:scale-[1.04] disabled:opacity-50"
        >
          <Sparkles size={20} /> Призыв ×10
        </button>
      </div>
    </div>
  )
}

function star(points: number, r: number, skip = 0) {
  // a regular polygon, or a star when its vertices are joined `skip` apart (5 points, skip 2: a pentagram)
  const out: string[] = []
  for (let i = 0; i < points; i++) {
    const k = (i * (skip || 1)) % points
    const ang = (k / points) * Math.PI * 2
    out.push(`${Math.sin(ang) * r},${-Math.cos(ang) * r}`)
  }
  return out.join(' ')
}

function useHref(a: ShikiAnime) {
  const l = useLibriaIndex((s) => s.byMal[a.id])
  return l ? `/title/${l.alias}` : `/anime/${a.id}`
}

function Stars({ r }: { r: Rarity }) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: RARITY[r].stars }, (_, i) => (
        <Star key={i} size={12} className="fill-current" style={{ color: RARITY[r].color }} />
      ))}
    </span>
  )
}

function BigCard({ a, open }: { a: ShikiAnime; open: boolean }) {
  const href = useHref(a)
  const r = rarityOf(Number(a.score))
  const year = a.aired_on?.slice(0, 4)
  return (
    <div className="flex w-full flex-col items-center gap-6 p-6 sm:flex-row sm:justify-center sm:gap-10">
      <div className={cn('gacha-card', open && 'open', r === 'SSR' && 'ssr')}>
        <div className="gacha-inner">
          <div className="gacha-back" />
          <div className="gacha-front" style={{ background: RARITY[r].glow }}>
            <img src={shImg(a.image.original)} alt="" className="h-full w-full rounded-[18px] object-cover" />
            <span className="absolute top-3 left-3 rounded-lg bg-black/70 px-2 py-0.5 text-sm font-black tracking-wider" style={{ color: RARITY[r].color }}>
              {r}
            </span>
          </div>
        </div>
      </div>
      {open && (
        <div className="animate-fade-up flex max-w-md flex-col items-center gap-3 text-center sm:items-start sm:text-left">
          <Stars r={r} />
          <div className="text-xs font-extrabold tracking-[0.25em] uppercase" style={{ color: RARITY[r].color }}>
            {r === 'SSR' ? 'Легендарный призыв!' : r === 'SR' ? 'Редкий призыв' : 'Призыв'}
          </div>
          <h2 className="text-3xl leading-tight font-extrabold">{shikiTitle(a)}</h2>
          <div className="text-sm font-semibold text-muted">
            {[a.kind ? KINDS[a.kind] ?? a.kind : null, year, a.episodes ? `${a.episodes} эп.` : null, Number(a.score) ? `★ ${a.score}` : null].filter(Boolean).join(' · ')}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to={href} className="flex h-11 items-center gap-2 rounded-full bg-white px-6 font-extrabold text-black">
              <Play size={16} fill="currentColor" /> Смотреть
            </Link>
            <Link to={`/anime/${a.id}`} className="flex h-11 items-center gap-2 rounded-full bg-white/10 px-5 font-bold ring-1 ring-white/10 hover:bg-white/15">
              <ListPlus size={16} /> Подробнее
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function SmallCard({ a, open }: { a: ShikiAnime; open: boolean }) {
  const href = useHref(a)
  const r = rarityOf(Number(a.score))
  return (
    <Link to={href} className={cn('gacha-card small', open && 'open', r === 'SSR' && 'ssr')} title={shikiTitle(a)}>
      <div className="gacha-inner">
        <div className="gacha-back" />
        <div className="gacha-front" style={{ background: RARITY[r].glow }}>
          <img src={shImg(a.image.preview)} alt="" className="h-full w-full rounded-[12px] object-cover" />
          <span className="absolute top-1.5 left-1.5 rounded-md bg-black/70 px-1.5 text-[11px] font-black" style={{ color: RARITY[r].color }}>
            {r}
          </span>
          <span className="absolute inset-x-1 bottom-1 line-clamp-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] leading-tight font-bold">{shikiTitle(a)}</span>
        </div>
      </div>
    </Link>
  )
}

function Chip({ on, onClick, children, small }: { on: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button onClick={onClick} className={cn('rounded-full font-bold ring-1 transition', small ? 'px-3.5 py-1.5 text-sm' : 'px-5 py-2.5', on ? 'bg-white text-black ring-white' : 'bg-white/[0.04] ring-white/10 hover:bg-white/10')}>
      {children}
    </button>
  )
}

function Opt({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-sm font-bold text-muted">{label}</span>
      {children}
    </div>
  )
}

const CSS = `
.gacha-circle svg { filter: drop-shadow(0 0 10px var(--color-glow)); }
.gacha-circle .ring-a { animation: g-spin 40s linear infinite; transform-origin: center; }
.gacha-circle .ring-b { animation: g-spin 26s linear infinite reverse; transform-origin: center; }
.gacha-circle .ring-c { animation: g-spin 18s linear infinite; transform-origin: center; }
.gacha-circle .core { animation: g-pulse 2.4s ease-in-out infinite; transform-origin: center; filter: blur(3px); }
.gacha-circle.charging .ring-a { animation-duration: 3s; }
.gacha-circle.charging .ring-b { animation-duration: 1.8s; }
.gacha-circle.charging .ring-c { animation-duration: 1.1s; }
.gacha-circle.charging .core { animation: g-charge 1.7s ease-in forwards; }
.gacha-circle.charging svg { animation: g-shake .12s linear infinite; filter: drop-shadow(0 0 22px var(--color-glow)) brightness(1.4); }
.gacha-circle .mote { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; border-radius: 9999px; background: var(--color-accent-2); box-shadow: 0 0 12px var(--color-accent-2);
  animation: g-mote 1s ease-in infinite; animation-delay: var(--d); }
@keyframes g-spin { to { transform: rotate(360deg); } }
@keyframes g-pulse { 50% { transform: scale(1.35); opacity: .7; } }
@keyframes g-charge { to { transform: scale(7); opacity: 1; } }
@keyframes g-shake { 25% { transform: translate(1px,-1px); } 75% { transform: translate(-1px,1px); } }
@keyframes g-mote { from { transform: rotate(var(--a)) translateY(-170px) scale(1); opacity: 0; } 30% { opacity: 1; } to { transform: rotate(var(--a)) translateY(0) scale(.2); opacity: 0; } }
.gacha-flash { background: white; animation: g-flash .45s ease-out forwards; pointer-events: none; }
.gacha-flash.sr { background: radial-gradient(circle, #fff, #e9d5ff 40%, #a855f7); }
.gacha-flash.ssr { background: radial-gradient(circle, #fff, #fde68a 35%, #f472b6 65%, #60a5fa); }
@keyframes g-flash { from { opacity: 1; } to { opacity: 0; } }
.gacha-card { perspective: 1000px; width: 230px; aspect-ratio: 2/3; display: block; }
.gacha-card.small { width: 100%; }
.gacha-inner { position: relative; width: 100%; height: 100%; transition: transform .7s cubic-bezier(.2,.8,.2,1.2); transform-style: preserve-3d; }
.gacha-card.open .gacha-inner { transform: rotateY(180deg); }
.gacha-back, .gacha-front { position: absolute; inset: 0; border-radius: 20px; backface-visibility: hidden; }
.gacha-card.small .gacha-back, .gacha-card.small .gacha-front { border-radius: 14px; }
.gacha-back { background: radial-gradient(circle at 50% 40%, var(--color-accent-2), var(--color-accent) 45%, #0b0b14 100%); box-shadow: inset 0 0 0 3px rgba(255,255,255,.25), 0 10px 30px rgba(0,0,0,.5); }
.gacha-back::after { content: '✦'; position: absolute; inset: 0; display: grid; place-items: center; font-size: 56px; color: rgba(255,255,255,.75); }
.gacha-front { transform: rotateY(180deg); padding: 4px; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
.gacha-card.ssr.open .gacha-front { animation: g-ssr 2.2s linear infinite; }
@keyframes g-ssr { 50% { box-shadow: 0 0 46px 6px rgba(251,191,36,.55); } }
`
