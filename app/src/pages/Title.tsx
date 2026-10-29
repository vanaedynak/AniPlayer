import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Play, Star, Calendar, Clock, Film, Users, ArrowDownUp } from 'lucide-react'
import { api, posterUrl, episodePreview, sortedEpisodes } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { useStore, progressKey } from '../lib/store'
import { EpisodeCard, Skeleton, Chip, Empty } from '../components/ui'
import { StatusPicker, Franchise } from '../components/TitleBits'
import { fmtOrdinal, fmtTime, cn } from '../lib/format'

export const PAGE = 24

export function useResumeTarget(releaseId: number | undefined, episodes: { ordinal: number }[]) {
  const entry = useStore((s) => (releaseId ? s.titles[releaseId] : undefined))
  const progress = useStore((s) => s.progress)
  return useMemo(() => {
    if (!releaseId || !episodes.length) return null
    const last = entry?.lastOrdinal
    if (last == null) return { ordinal: episodes[0].ordinal, label: 'Смотреть', time: 0 }
    const p = progress[progressKey(releaseId, last)]
    if (p?.watched) {
      const idx = episodes.findIndex((e) => e.ordinal === last)
      const nxt = episodes[idx + 1]
      if (nxt) return { ordinal: nxt.ordinal, label: `Продолжить · ${fmtOrdinal(nxt.ordinal)} серия`, time: 0 }
      return { ordinal: last, label: `Пересмотреть ${fmtOrdinal(last)} серию`, time: 0 }
    }
    return { ordinal: last, label: `Продолжить · ${fmtOrdinal(last)} серия`, time: p?.time ?? 0 }
  }, [releaseId, entry?.lastOrdinal, progress, episodes])
}

export function EpisodeRanges({ count, page, setPage, reverse, setReverse }: { count: number; page: number; setPage: (n: number) => void; reverse?: boolean; setReverse?: (v: boolean) => void }) {
  const pages = Math.ceil(count / PAGE)
  return (
    <div className="no-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
      {setReverse && (
        <button
          onClick={() => setReverse(!reverse)}
          title="Порядок"
          className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-white/10', reverse ? 'bg-white text-black' : 'bg-card-2')}
        >
          <ArrowDownUp size={16} />
        </button>
      )}
      {pages > 1 &&
        Array.from({ length: pages }, (_, i) => (
          <Chip key={i} active={i === page} onClick={() => setPage(i)}>
            {i * PAGE + 1}–{Math.min(count, (i + 1) * PAGE)}
          </Chip>
        ))}
    </div>
  )
}

export default function Title() {
  const { alias = '' } = useParams()
  const { data: r, error } = useAsync(() => api.release(alias), [alias])
  const episodes = useMemo(() => (r ? sortedEpisodes(r) : []), [r])
  const resume = useResumeTarget(r?.id, episodes)
  const [page, setPage] = useState<number | null>(null)
  const [reverse, setReverse] = useState(false)
  const [more, setMore] = useState(false)

  const list = reverse ? [...episodes].reverse() : episodes
  const resumeIdx = resume ? list.findIndex((e) => e.ordinal === resume.ordinal) : 0
  const curPage = page ?? Math.max(0, Math.floor(resumeIdx / PAGE))

  if (error) return <Empty icon={<Film />} title="Не удалось загрузить тайтл" text={error} />
  if (!r)
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-[420px] w-full rounded-[32px]" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-video" />
          ))}
        </div>
      </div>
    )

  const banner = episodePreview(episodes[Math.min(2, episodes.length - 1)]) || posterUrl(r)
  const rating = r.mal?.rating ?? r.shikimori?.rating
  const voice = r.members?.filter((m) => m.role.value === 'voicing').map((m) => m.nickname)

  return (
    <div className="flex flex-col gap-10">
      <div className="animate-fade-up relative z-10 rounded-[32px] ring-1 ring-white/5">
        {/* background is clipped on its own so dropdowns can overflow the banner */}
        <div className="absolute inset-0 overflow-hidden rounded-[32px]">
          <img src={banner} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/30" />
        </div>
        <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:p-10">
          <img src={posterUrl(r)} alt="" className="w-44 shrink-0 self-center rounded-3xl shadow-2xl shadow-black/60 ring-1 ring-white/10 sm:w-60 sm:self-start" />
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              {r.is_ongoing && <span className="rounded-full bg-accent px-3 py-1">Онгоинг</span>}
              {r.age_rating?.label && <span className="glass rounded-full px-3 py-1">{r.age_rating.label}</span>}
              {r.genres?.map((g) => (
                <Link key={g.id} to={`/catalog?genre=${g.id}`} className="glass rounded-full px-3 py-1 hover:bg-white/15">
                  {g.name}
                </Link>
              ))}
            </div>
            <div>
              <h1 className="text-3xl leading-tight font-extrabold tracking-tight sm:text-5xl">{r.name.main}</h1>
              {r.name.english && <div className="mt-1 text-base font-semibold text-muted">{r.name.english}</div>}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-white/80">
              {rating ? (
                <span className="flex items-center gap-1.5">
                  <Star size={16} className="fill-yellow-400 text-yellow-400" /> {rating.toFixed(1)} MAL
                </span>
              ) : null}
              <span className="flex items-center gap-1.5">
                <Film size={16} /> {r.type?.description}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar size={16} /> {r.season?.description} {r.year}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={16} /> {episodes.length}
                {r.episodes_total && r.episodes_total !== episodes.length ? ` из ${r.episodes_total}` : ''} эп.
                {r.average_duration_of_episode ? ` · ~${r.average_duration_of_episode} мин` : ''}
              </span>
              {r.publish_day && r.is_ongoing && <span>Новые серии: {r.publish_day.description.toLowerCase()}</span>}
            </div>
            {r.description && (
              <p className={cn('max-w-3xl text-[15px] leading-relaxed whitespace-pre-line text-white/80', !more && 'line-clamp-4')}>
                {r.description}
              </p>
            )}
            {r.description && r.description.length > 300 && (
              <button onClick={() => setMore(!more)} className="self-start text-sm font-bold text-accent-2">
                {more ? 'Свернуть' : 'Читать полностью'}
              </button>
            )}
            {voice && voice.length > 0 && (
              <div className="flex items-start gap-2 text-sm text-muted">
                <Users size={16} className="mt-0.5 shrink-0" /> Озвучка: {voice.join(', ')}
              </div>
            )}
            <div className="mt-1 flex flex-wrap gap-3">
              {resume && (
                <Link
                  to={`/watch/${r.alias}/${resume.ordinal}`}
                  className="flex h-12 items-center gap-2 rounded-full bg-white px-7 font-extrabold text-black transition hover:scale-[1.03]"
                >
                  <Play size={18} fill="currentColor" /> {resume.label}
                  {resume.time > 5 && <span className="font-semibold text-black/50">· {fmtTime(resume.time)}</span>}
                </Link>
              )}
              <StatusPicker r={r} />
            </div>
          </div>
        </div>
      </div>

      {r.is_blocked_by_geo && (
        <div className="rounded-2xl bg-rose-500/10 p-4 text-sm font-semibold text-rose-300 ring-1 ring-rose-500/20">
          Тайтл заблокирован в вашем регионе.
        </div>
      )}

      <div className="grid gap-10 xl:grid-cols-[1fr_320px]">
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-extrabold">Серии</h2>
            <EpisodeRanges count={list.length} page={curPage} setPage={setPage} reverse={reverse} setReverse={setReverse} />
          </div>
          {episodes.length ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-4">
              {list.slice(curPage * PAGE, (curPage + 1) * PAGE).map((e) => (
                <EpisodeCard key={e.id} r={r} e={e} active={resume?.ordinal === e.ordinal && resume.label !== 'Смотреть'} />
              ))}
            </div>
          ) : (
            <Empty icon={<Clock />} title="Серий пока нет" text={r.notification ?? 'Тайтл ещё в работе у команды AniLibria.'} />
          )}
        </section>
        <aside>
          <Franchise r={r} />
        </aside>
      </div>
    </div>
  )
}
