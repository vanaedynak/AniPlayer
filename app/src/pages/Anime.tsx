import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { Star, Film, Calendar, Clock, Loader2, Mic, Captions, MonitorPlay, Play } from 'lucide-react'
import { shiki, shikiToRelease, shImg, shikiTitle, stripBB, useShikiPoster, KINDS, STATUSES } from '../lib/shikimori'
import { findYummy, yummyDubs, dubLabel, type YDub } from '../lib/yummy'
import { useLibriaIndex } from '../lib/libriaIndex'
import { useAsync } from '../lib/useAsync'
import { useStore } from '../lib/store'
import KodikPlayer from '../components/KodikPlayer'
import { StatusPicker } from '../components/TitleBits'
import { FranchiseRow, SeasonTabs } from '../components/FranchiseRow'
import { ThemesSection } from '../components/Music'
import { Skeleton, Empty, Chip } from '../components/ui'
import { SeasonEpisodes } from '../components/SeasonEpisodes'
import { cn, fmtOrdinal } from '../lib/format'

const DUB_KEY = 'aniplayer-yummy-dub' // remembered dub per title, on this device

/** any anime from Shikimori: AniLibria titles go to our player, the rest play every dub YummyAnime knows */
export default function Anime() {
  const { id = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const forceKodik = sp.get('kodik') === '1'
  const libria = useLibriaIndex((s) => s.byMal[Number(id)])
  const { data: a, error } = useAsync(() => shiki.anime(id), [id])
  const r = useMemo(() => (a ? shikiToRelease(a) : null), [a])
  const entry = useStore((s) => (r ? s.titles[r.id] : undefined))
  const touchTitle = useStore((s) => s.touchTitle)

  const [dubs, setDubs] = useState<YDub[] | null>(null)
  const [dubErr, setDubErr] = useState('')
  const [dubKey, setDubKey] = useState<string | null>(null)
  const [playerIdx, setPlayerIdx] = useState(0)
  const [altPoster, setAltPoster] = useState('')
  const shikiPoster = useShikiPoster(a ? shImg(a.image.original) : '', a?.id)

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
        const fromUrl = new URLSearchParams(location.hash.split('?')[1] ?? '').get('dub')
        setDubKey(list.find((d) => d.key === fromUrl)?.key ?? list.find((d) => d.key === saved[a.id])?.key ?? list[0]?.key ?? null)
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
  // the page opens on the episode list; the player comes up once an episode is picked
  const showPlayer = epParam > 0
  const playerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (showPlayer && video) playerRef.current?.scrollIntoView({ block: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epParam, !!video])

  const selectEp = (n: number) => {
    const next = new URLSearchParams(sp)
    next.set('ep', String(n))
    setSp(next, { replace: true })
  }
  const selectDub = (d: YDub) => {
    setDubKey(d.key)
    setPlayerIdx(0)
    const next = new URLSearchParams(sp)
    next.set('dub', d.key)
    setSp(next, { replace: true })
    try {
      const saved = JSON.parse(localStorage.getItem(DUB_KEY) ?? '{}')
      saved[a!.id] = d.key
      localStorage.setItem(DUB_KEY, JSON.stringify(saved))
    } catch {
      /* ignore */
    }
  }

  // the title is remembered here; history and "continue watching" pick it up once an episode plays
  useEffect(() => {
    if (!r || !dub || !showPlayer) return
    if (!useStore.getState().titles[r.id]) touchTitle(r, {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id, dub?.key, episode])

  if (libria && !forceKodik) return <Navigate to={`/title/${libria.alias}`} replace />
  if (error) return <Empty icon={<Film />} title="Не удалось загрузить аниме" text={error} />
  if (!a || !r) return <Skeleton className="h-[420px] w-full rounded-[32px]" />

  const desc = stripBB(a.description)
  // Shikimori has no art for brand-new titles yet
  const poster = shikiPoster.includes('/missing_') && altPoster ? altPoster : shikiPoster
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
              {!showPlayer && dub && numbers.length > 0 && (
                <button
                  onClick={() => selectEp(episode)}
                  className="flex h-12 items-center gap-2 rounded-full bg-white px-7 font-extrabold text-black transition hover:scale-[1.03]"
                >
                  <Play size={18} fill="currentColor" /> {entry?.lastOrdinal ? `Продолжить · ${fmtOrdinal(episode)} серия` : 'Смотреть'}
                </button>
              )}
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
      ) : !showPlayer ? null : (
        <div ref={playerRef} className="flex scroll-mt-20 flex-col gap-6">
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
        </div>
      )}
      <SeasonTabs malId={a.id} />
      <SeasonEpisodes
        release={null}
        malId={a.id}
        current={showPlayer || entry?.lastOrdinal ? { releaseId: r.id, ordinal: episode } : undefined}
        replace={showPlayer}
      />
      <ThemesSection malId={a.id} />
      <FranchiseRow malId={a.id} />
    </div>
  )
}
