import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { Star, Film, Calendar, Clock, KeyRound, Loader2, Check, Mic, Captions } from 'lucide-react'
import { shiki, shikiToRelease, shImg, shikiTitle, stripBB, KINDS, STATUSES } from '../lib/shikimori'
import { kodikDubs, type Dub } from '../lib/kodik'
import { useLibriaIndex } from '../lib/libriaIndex'
import { useAsync } from '../lib/useAsync'
import { useStore, progressKey } from '../lib/store'
import KodikPlayer from '../components/KodikPlayer'
import { StatusPicker } from '../components/TitleBits'
import { Skeleton, Empty, Panel, Chip } from '../components/ui'
import { cn } from '../lib/format'

const DUB_KEY = 'aniplayer-kodik-dub' // remembered dub per title, on this device

/** any anime from Shikimori: AniLibria titles go to our player, the rest play through Kodik */
export default function Anime() {
  const { id = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const forceKodik = sp.get('kodik') === '1'
  const libria = useLibriaIndex((s) => s.byMal[Number(id)])
  const { data: a, error } = useAsync(() => shiki.anime(id), [id])
  const r = useMemo(() => (a ? shikiToRelease(a) : null), [a])
  const token = useStore((s) => s.prefs.kodikToken)
  const entry = useStore((s) => (r ? s.titles[r.id] : undefined))
  const progress = useStore((s) => s.progress)
  const touchTitle = useStore((s) => s.touchTitle)

  const [dubs, setDubs] = useState<Dub[] | null>(null)
  const [dubErr, setDubErr] = useState('')
  const [dubId, setDubId] = useState<number | null>(null)

  useEffect(() => {
    if (!token || !a) return
    setDubs(null)
    setDubErr('')
    kodikDubs(token, a.id)
      .then((list) => {
        setDubs(list)
        let saved: Record<string, number> = {}
        try {
          saved = JSON.parse(localStorage.getItem(DUB_KEY) ?? '{}')
        } catch {
          /* ignore */
        }
        setDubId(list.find((d) => d.id === saved[a.id])?.id ?? list[0]?.id ?? null)
      })
      .catch((e) => setDubErr(String(e.message ?? e)))
  }, [token, a])

  const dub = dubs?.find((d) => d.id === dubId) ?? null
  const epParam = Number(sp.get('ep'))
  const episode = epParam > 0 ? epParam : entry?.lastOrdinal ?? 1
  const total = dub?.episodes ?? 0

  const selectEp = (n: number) => {
    const next = new URLSearchParams(sp)
    next.set('ep', String(n))
    setSp(next, { replace: true })
  }
  const selectDub = (d: Dub) => {
    setDubId(d.id)
    try {
      const saved = JSON.parse(localStorage.getItem(DUB_KEY) ?? '{}')
      saved[a!.id] = d.id
      localStorage.setItem(DUB_KEY, JSON.stringify(saved))
    } catch {
      /* ignore */
    }
  }

  // watching through Kodik also feeds history and "continue watching"
  useEffect(() => {
    if (!r || !dub) return
    touchTitle(r, { lastOrdinal: episode, lastWatchedAt: Date.now(), status: useStore.getState().titles[r.id]?.status ?? 'watching' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id, dub?.id, episode])

  if (libria && !forceKodik) return <Navigate to={`/title/${libria.alias}`} replace />
  if (error) return <Empty icon={<Film />} title="Не удалось загрузить аниме" text={error} />
  if (!a || !r) return <Skeleton className="h-[420px] w-full rounded-[32px]" />

  const desc = stripBB(a.description)
  return (
    <div className="flex flex-col gap-8">
      <div className="animate-fade-up relative z-10 rounded-[32px] ring-1 ring-white/5">
        <div className="absolute inset-0 overflow-hidden rounded-[32px]">
          <img src={shImg(a.image.original)} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/30" />
        </div>
        <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:p-10">
          <img src={shImg(a.image.original)} alt="" className="w-40 shrink-0 self-center rounded-3xl shadow-2xl ring-1 ring-white/10 sm:w-52 sm:self-start" />
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              {a.status === 'ongoing' && <span className="rounded-full bg-accent px-3 py-1">Онгоинг</span>}
              <span className="glass rounded-full px-3 py-1">Kodik</span>
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

      {!token ? (
        <Panel>
          <div className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-3 text-xl font-extrabold">
              <KeyRound className="text-accent-2" /> Этого аниме нет у AniLibria
            </div>
            <p className="max-w-2xl text-sm text-white/75">
              Другие озвучки (Studio Band, AniDUB и т.д.) идут через плеер Kodik. Для него нужен API‑токен Kodik — вставьте его в настройках один раз,
              и он появится на всех устройствах.
            </p>
            <Link to="/settings" className="rounded-full bg-white px-5 py-2.5 font-bold text-black">
              Открыть настройки
            </Link>
          </div>
        </Panel>
      ) : dubErr ? (
        <Empty icon={<KeyRound />} title="Kodik не ответил" text={dubErr} />
      ) : !dubs ? (
        <div className="flex items-center gap-3 font-semibold text-muted">
          <Loader2 className="animate-spin" /> Ищем озвучки…
        </div>
      ) : dubs.length === 0 || !dub ? (
        <Empty icon={<Film />} title="У Kodik нет этого аниме" />
      ) : (
        <div className="flex flex-col gap-6">
          <KodikPlayer release={r} dub={dub} episode={Math.min(episode, total)} hasNext={episode < total} onNext={() => selectEp(episode + 1)} />
          <section>
            <h2 className="mb-3 text-xl font-extrabold">Озвучка</h2>
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {dubs.map((d) => (
                <Chip key={d.id} active={d.id === dub.id} onClick={() => selectDub(d)}>
                  <span className="flex items-center gap-1.5">
                    {d.type === 'subtitles' ? <Captions size={14} /> : <Mic size={14} />}
                    {d.title}
                    <span className="opacity-50">{d.episodes}</span>
                  </span>
                </Chip>
              ))}
            </div>
          </section>
          {total > 1 && (
            <section>
              <h2 className="mb-3 text-xl font-extrabold">Серии · {total}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
                {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
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
    </div>
  )
}
