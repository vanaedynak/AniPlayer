import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { Star, Film, Calendar, Clock, Loader2, Check, Mic, Captions, MonitorPlay } from 'lucide-react'
import { shiki, shikiToRelease, shImg, shikiTitle, stripBB, KINDS, STATUSES } from '../lib/shikimori'
import { findYummy, yummyDubs, dubLabel, type YDub } from '../lib/yummy'
import { useLibriaIndex } from '../lib/libriaIndex'
import { useAsync } from '../lib/useAsync'
import { useStore, progressKey } from '../lib/store'
import KodikPlayer from '../components/KodikPlayer'
import { StatusPicker } from '../components/TitleBits'
import { FranchiseRow } from '../components/FranchiseRow'
import { Skeleton, Empty, Chip } from '../components/ui'
import { cn, fmtOrdinal } from '../lib/format'

const DUB_KEY = 'aniplayer-yummy-dub' // remembered dub per title, on this device
const EP_PAGE = 100

/** any anime from Shikimori: AniLibria titles go to our player, the rest play every dub YummyAnime knows */
export default function Anime() {
  const { id = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const forceKodik = sp.get('kodik') === '1'
  const libria = useLibriaIndex((s) => s.byMal[Number(id)])
  const { data: a, error } = useAsync(() => shiki.anime(id), [id])
  const r = useMemo(() => (a ? shikiToRelease(a) : null), [a])
  const entry = useStore((s) => (r ? s.titles[r.id] : undefined))
  const progress = useStore((s) => s.progress)
  const touchTitle = useStore((s) => s.touchTitle)

  const [dubs, setDubs] = useState<YDub[] | null>(null)
  const [dubErr, setDubErr] = useState('')
  const [dubKey, setDubKey] = useState<string | null>(null)
  const [playerIdx, setPlayerIdx] = useState(0)
  const [page, setPage] = useState<number | null>(null)
  const [altPoster, setAltPoster] = useState('')

  useEffect(() => {
    if (!a || (libria && !forceKodik)) return
    let alive = true
    setDubs(null)
    setDubErr('')
    findYummy(a)
      .then((y) => {
        if (alive && y?.poster) setAltPoster(y.poster)
        return y ? yummyDubs(y.id) : []
      })
      .then((list) => {
        if (!alive) return
        setDubs(list)
        let saved: Record<string, string> = {}
        try {
          saved = JSON.parse(localStorage.getItem(DUB_KEY) ?? '{}')
        } catch {
          /* ignore */
        }
        setDubKey(list.find((d) => d.key === saved[a.id])?.key ?? list[0]?.key ?? null)
      })
      .catch((e) => alive && setDubErr(String(e.message ?? e)))
    return () => {
      alive = false
    }
  }, [a, libria, forceKodik])

  const dub = dubs?.find((d) => d.key === dubKey) ?? null
  const numbers = useMemo(() => (dub ? [...dub.episodes.keys()].sort((x, y) => x - y) : []), [dub])
  const epParam = Number(sp.get('ep'))
  const wanted = epParam > 0 ? epParam : entry?.lastOrdinal ?? numbers[0] ?? 1
  const episode = dub?.episodes.has(wanted) ? wanted : numbers.find((n) => n >= wanted) ?? numbers[numbers.length - 1] ?? 1
  const players = dub?.episodes.get(episode) ?? []
  const video = players[Math.min(playerIdx, players.length - 1)]
  const nextEp = numbers[numbers.indexOf(episode) + 1]
  const pages = Math.ceil(numbers.length / EP_PAGE)
  const curPage = page ?? Math.max(0, Math.floor(numbers.indexOf(episode) / EP_PAGE))

  const selectEp = (n: number) => {
    const next = new URLSearchParams(sp)
    next.set('ep', String(n))
    setSp(next, { replace: true })
  }
  const selectDub = (d: YDub) => {
    setDubKey(d.key)
    setPlayerIdx(0)
    try {
      const saved = JSON.parse(localStorage.getItem(DUB_KEY) ?? '{}')
      saved[a!.id] = d.key
      localStorage.setItem(DUB_KEY, JSON.stringify(saved))
    } catch {
      /* ignore */
    }
  }

  // watching here also feeds history and "continue watching"
  useEffect(() => {
    if (!r || !dub) return
    touchTitle(r, { lastOrdinal: episode, lastWatchedAt: Date.now(), status: useStore.getState().titles[r.id]?.status ?? 'watching' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id, dub?.key, episode])

  if (libria && !forceKodik) return <Navigate to={`/title/${libria.alias}`} replace />
  if (error) return <Empty icon={<Film />} title="Не удалось загрузить аниме" text={error} />
  if (!a || !r) return <Skeleton className="h-[420px] w-full rounded-[32px]" />

  const desc = stripBB(a.description)
  // Shikimori has no art for brand-new titles yet
  const poster = a.image.original.includes('missing') && altPoster ? altPoster : shImg(a.image.original)
  return (
    <div className="flex flex-col gap-8">
      <div className="animate-fade-up relative z-10 rounded-[32px] ring-1 ring-white/5">
        <div className="absolute inset-0 overflow-hidden rounded-[32px]">
          <img src={poster} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/30" />
        </div>
        <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:p-10">
          <img src={poster} alt="" className="w-40 shrink-0 self-center rounded-3xl shadow-2xl ring-1 ring-white/10 sm:w-52 sm:self-start" />
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              {a.status === 'ongoing' && <span className="rounded-full bg-accent px-3 py-1">Онгоинг</span>}
              {a.genres?.slice(0, 5).map((g) => (
                <span key={g.id} className="glass rounded-full px-3 py-1">
                  {g.russian}
                </span>
              ))}
            </div>
            <div>
              <h1 className="text-3xl leading-tight font-extrabold tracking-tight sm:text-5xl">{shikiTitle(a)}</h1>
              <div className="mt-1 font-semibold text-muted">{a.name}</div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-white/80">
              {Number(a.score) > 0 && (
                <span className="flex items-center gap-1.5">
                  <Star size={16} className="fill-yellow-400 text-yellow-400" /> {a.score}
                </span>
              )}
              {a.kind && (
                <span className="flex items-center gap-1.5">
                  <Film size={16} /> {KINDS[a.kind] ?? a.kind}
                </span>
              )}
              {a.aired_on && (
                <span className="flex items-center gap-1.5">
                  <Calendar size={16} /> {a.aired_on.slice(0, 4)} · {STATUSES[a.status] ?? a.status}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Clock size={16} /> {a.episodes || a.episodes_aired || '?'} эп.{a.duration ? ` · ${a.duration} мин` : ''}
              </span>
            </div>
            {desc && <p className="line-clamp-4 max-w-3xl text-[15px] leading-relaxed text-white/80">{desc}</p>}
            <div className="flex flex-wrap gap-3">
              <StatusPicker r={r} />
              {libria && (
                <Link to={`/title/${libria.alias}`} className="flex h-12 items-center rounded-full bg-white px-6 font-extrabold text-black">
                  Смотреть в озвучке AniLibria
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {dubErr ? (
        <Empty icon={<Film />} title="Источник не ответил" text={dubErr} />
      ) : !dubs ? (
        <div className="flex items-center gap-3 font-semibold text-muted">
          <Loader2 className="animate-spin" /> Ищем озвучки…
        </div>
      ) : dubs.length === 0 || !dub || !video ? (
        <Empty icon={<Film />} title="Серий пока нет" text="Ни одной озвучки этого аниме не нашлось. Загляните позже." />
      ) : (
        <div className="flex flex-col gap-6">
          <KodikPlayer release={r} src={video.url} episode={episode} op={video.op} ed={video.ed} hasNext={nextEp != null} onNext={() => nextEp != null && selectEp(nextEp)} />
          <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-muted">
            <span className="text-white">
              {fmtOrdinal(episode)} серия · {dubLabel(dub)}
            </span>
            {players.length > 1 && (
              <span className="flex items-center gap-1.5">
                <MonitorPlay size={15} /> Плеер:
                {players.map((p, i) => (
                  <button
                    key={p.url}
                    onClick={() => setPlayerIdx(i)}
                    className={cn('rounded-full px-2.5 py-0.5 ring-1 transition', video === p ? 'bg-white text-black ring-white' : 'ring-white/15 hover:bg-white/10')}
                  >
                    {p.player}
                  </button>
                ))}
              </span>
            )}
            {!video.kodik && <span className="text-amber-300/80">В этом плеере позиция не запоминается — для синхронизации выберите Kodik</span>}
          </div>
          <section>
            <h2 className="mb-3 text-xl font-extrabold">
              Озвучка <span className="text-sm font-semibold text-muted">· {dubs.length}</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {dubs.map((d) => (
                <Chip key={d.key} active={d.key === dub.key} onClick={() => selectDub(d)}>
                  <span className="flex items-center gap-1.5">
                    {d.kind === 'subtitles' ? <Captions size={14} /> : <Mic size={14} />}
                    {dubLabel(d)}
                    <span className="opacity-50">{d.count}</span>
                  </span>
                </Chip>
              ))}
            </div>
          </section>
          {numbers.length > 1 && (
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-extrabold">Серии · {numbers.length}</h2>
                {pages > 1 && (
                  <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
                    {Array.from({ length: pages }, (_, i) => (
                      <Chip key={i} active={i === curPage} onClick={() => setPage(i)}>
                        {numbers[i * EP_PAGE]}–{numbers[Math.min(numbers.length, (i + 1) * EP_PAGE) - 1]}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
                {numbers.slice(curPage * EP_PAGE, (curPage + 1) * EP_PAGE).map((n) => {
                  const p = progress[progressKey(r.id, n)]
                  const ratio = p ? (p.watched ? 1 : p.duration ? p.time / p.duration : 0) : 0
                  return (
                    <button
                      key={n}
                      onClick={() => selectEp(n)}
                      className={cn(
                        'relative h-12 overflow-hidden rounded-xl font-bold ring-1 transition',
                        n === episode ? 'bg-white text-black ring-white' : 'bg-card-2 ring-white/5 hover:bg-white/10',
                        p?.watched && n !== episode && 'text-white/50',
                      )}
                    >
                      {p?.watched && n !== episode ? <Check size={16} className="mx-auto" /> : n}
                      {ratio > 0 && ratio < 1 && <span className="absolute bottom-0 left-0 h-1 bg-accent-2" style={{ width: `${ratio * 100}%` }} />}
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      )}
      <FranchiseRow malId={a.id} />
    </div>
  )
}
