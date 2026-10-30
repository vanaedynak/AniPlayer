import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, ChevronLeft, Check, Film, RotateCcw } from 'lucide-react'
import { api, posterUrl, episodePreview, sortedEpisodes, type Episode } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { useStore, progressKey } from '../lib/store'
import Player from '../components/Player'
import { EpisodeCard, Skeleton, Empty, Panel } from '../components/ui'
import { StatusPicker, Franchise } from '../components/TitleBits'
import { DownloadEpisodeButton } from '../components/Downloads'
import { releaseOrOffline } from '../lib/downloads'
import { EpisodeRanges, PAGE } from './Title'
import { fmtOrdinal, cn } from '../lib/format'

export default function Watch() {
  const { alias = '', ordinal = '1' } = useParams()
  const nav = useNavigate()
  const { data: r, error } = useAsync(() => releaseOrOffline(alias, () => api.release(alias)), [alias])
  const episodes = useMemo(() => (r ? sortedEpisodes(r) : []), [r])
  const idx = Math.max(0, episodes.findIndex((e) => String(e.ordinal) === ordinal))
  const episode = episodes[idx] as Episode | undefined
  const [page, setPage] = useState<number | null>(null)
  const curPage = page ?? Math.floor(idx / PAGE)
  const touchTitle = useStore((s) => s.touchTitle)
  const p = useStore((s) => (r && episode ? s.progress[progressKey(r.id, episode.ordinal)] : undefined))
  const setWatched = useStore((s) => s.setWatched)

  // opening an episode puts it at the top of history on every device
  useEffect(() => {
    if (!r || !episode) return
    touchTitle(r, {
      lastOrdinal: episode.ordinal,
      lastWatchedAt: Date.now(),
      lastPreview: episodePreview(episode) || undefined,
      status: useStore.getState().titles[r.id]?.status ?? 'watching',
    })
    setPage(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id, episode?.ordinal])

  useEffect(() => {
    if (r) document.title = `${episode ? fmtOrdinal(episode.ordinal) + ' серия · ' : ''}${r.name.main}`
    return () => {
      document.title = 'AniPlayer'
    }
  }, [r, episode])

  const select = (e: Episode) => nav(`/watch/${alias}/${e.ordinal}`, { replace: true })

  if (error) return <Empty icon={<Film />} title="Не удалось загрузить тайтл" text={error} />
  if (!r)
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="aspect-video w-full rounded-3xl" />
        <Skeleton className="h-12 w-72" />
      </div>
    )
  if (!episode) return <Empty icon={<Film />} title="Серий пока нет" text={r.notification ?? undefined} action={<Link to={`/title/${r.alias}`} className="font-bold text-accent-2">К тайтлу</Link>} />

  const next = episodes[idx + 1]
  const prev = episodes[idx - 1]

  return (
    <div className="flex flex-col gap-8">
      <div className="animate-fade-in -mx-4 sm:mx-0">
        <Player release={r} episode={episode} next={next} prev={prev} onSelect={select} />
      </div>

      <div className="grid gap-10 xl:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link to={`/title/${r.alias}`} className="flex items-center gap-3 rounded-full bg-card-2 py-2 pr-5 pl-2 ring-1 ring-white/5 transition hover:bg-white/10">
              <img src={posterUrl(r, 'thumbnail')} alt="" className="h-10 w-10 rounded-full object-cover" />
              <span className="max-w-[260px] truncate font-extrabold">{r.name.main}</span>
            </Link>
            <div className="flex flex-wrap gap-2">
              {prev && (
                <button onClick={() => select(prev)} className="flex h-12 items-center gap-1 rounded-full bg-card-2 px-5 font-bold ring-1 ring-white/5 hover:bg-white/10">
                  <ChevronLeft size={18} /> Пред.
                </button>
              )}
              {next && (
                <button onClick={() => select(next)} className="flex h-12 items-center gap-1 rounded-full bg-white px-6 font-extrabold text-black transition hover:scale-[1.03]">
                  След. серия <ChevronRight size={18} />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                {fmtOrdinal(episode.ordinal)} серия
              </h1>
              {episode.name && <div className="mt-1 text-lg font-semibold text-muted">{episode.name}</div>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setWatched(r.id, episode.ordinal, !p?.watched, episode.duration ?? undefined)}
                className={cn(
                  'flex h-12 items-center gap-2 rounded-full px-5 font-bold ring-1 transition',
                  p?.watched ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' : 'bg-white/10 ring-white/10 hover:bg-white/15',
                )}
              >
                {p?.watched ? <RotateCcw size={17} /> : <Check size={18} />}
                {p?.watched ? 'Отметить непросмотренной' : 'Отметить просмотренной'}
              </button>
              <DownloadEpisodeButton r={r} e={episode} />
              <StatusPicker r={r} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-extrabold">Все серии · {episodes.length}</h2>
          </div>
          <EpisodeRanges count={episodes.length} page={curPage} setPage={setPage} />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-4">
            {episodes.slice(curPage * PAGE, (curPage + 1) * PAGE).map((e) => (
              <EpisodeCard key={e.id} r={r} e={e} active={e.id === episode.id} onClick={() => select(e)} />
            ))}
          </div>
        </div>

        <aside className="flex flex-col gap-6">
          <Panel className="!p-5">
            <div className="mb-2 text-lg font-extrabold">О тайтле</div>
            <p className="line-clamp-6 text-sm leading-relaxed text-white/75">{r.description}</p>
            <Link to={`/title/${r.alias}`} className="mt-3 inline-block text-sm font-bold text-accent-2">
              Подробнее
            </Link>
          </Panel>
          <Franchise r={r} />
        </aside>
      </div>
    </div>
  )
}
