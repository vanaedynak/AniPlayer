import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, Info, Star, Shuffle, ChevronRight } from 'lucide-react'
import { api, episodePreview, posterUrl, type Release } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { useStore, progressKey, watchHref } from '../lib/store'
import { Section, Row, ReleaseCard, WideCard, CardSkeletons, Skeleton } from '../components/ui'
import { fmtTime, fmtOrdinal, cn } from '../lib/format'

function Hero({ items }: { items: Release[] }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (items.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % items.length), 8000)
    return () => clearInterval(t)
  }, [items.length, i])
  const r = items[i]
  if (!r) return <Skeleton className="aspect-[16/7] min-h-[320px] w-full rounded-[32px]" />
  const genres = r.genres?.slice(0, 3).map((g) => g.name)
  return (
    <div className="relative min-h-[340px] overflow-hidden rounded-[32px] bg-card ring-1 ring-white/5 sm:aspect-[16/6.5]">
      {items.map((it, idx) => (
        <img
          key={it.id}
          src={episodePreview(it.latest_episode) || posterUrl(it)}
          alt=""
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-all duration-[1200ms] ease-out',
            idx === i ? 'scale-100 opacity-100' : 'scale-105 opacity-0',
          )}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/0" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
      <div key={r.id} className="animate-fade-up relative flex h-full flex-col justify-end gap-3 p-6 sm:max-w-[62%] sm:p-10">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          {r.is_ongoing && <span className="rounded-full bg-accent px-3 py-1">Онгоинг</span>}
          {r.latest_episode && <span className="glass rounded-full px-3 py-1">Новая серия · {fmtOrdinal(r.latest_episode.ordinal)}</span>}
          {r.mal?.rating ? (
            <span className="glass flex items-center gap-1 rounded-full px-3 py-1">
              <Star size={12} className="fill-yellow-400 text-yellow-400" /> {r.mal.rating.toFixed(1)}
            </span>
          ) : null}
        </div>
        <h1 className="line-clamp-2 text-3xl leading-[1.05] font-extrabold tracking-tight sm:text-5xl">{r.name.main}</h1>
        <div className="text-sm font-semibold text-white/70">
          {[r.type?.description, r.year, ...(genres ?? [])].filter(Boolean).join(' · ')}
        </div>
        <p className="line-clamp-2 max-w-2xl text-[15px] leading-relaxed text-white/80 sm:line-clamp-3">{r.description}</p>
        <div className="mt-2 flex gap-3">
          <Link
            to={r.latest_episode ? `/watch/${r.alias}/${r.latest_episode.ordinal}` : `/title/${r.alias}`}
            className="flex items-center gap-2 rounded-full bg-white px-7 py-3.5 font-extrabold text-black transition hover:scale-[1.03]"
          >
            <Play size={18} fill="currentColor" /> Смотреть
          </Link>
          <Link to={`/title/${r.alias}`} className="glass flex items-center gap-2 rounded-full px-6 py-3.5 font-bold ring-1 ring-white/15 transition hover:bg-white/15">
            <Info size={18} /> Подробнее
          </Link>
        </div>
      </div>
      <div className="absolute right-6 bottom-6 hidden gap-2 sm:flex">
        {items.map((it, idx) => (
          <button
            key={it.id}
            onClick={() => setI(idx)}
            className={cn('h-2 rounded-full transition-all', idx === i ? 'w-8 bg-white' : 'w-2 bg-white/35 hover:bg-white/60')}
            aria-label={it.name.main}
          />
        ))}
      </div>
    </div>
  )
}

export function ContinueRow() {
  const titles = useStore((s) => s.titles)
  const progress = useStore((s) => s.progress)
  const items = useMemo(
    () =>
      Object.values(titles)
        .filter((t) => t.lastWatchedAt && t.lastOrdinal != null)
        .sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0))
        .slice(0, 12),
    [titles],
  )
  if (!items.length) return null
  return (
    <Section title="Продолжить просмотр" action={<Link to="/history" className="flex items-center text-sm font-bold text-muted hover:text-white">Вся история <ChevronRight size={16} /></Link>}>
      <Row itemClass="w-[290px] sm:w-[400px]">
        {items.map((t) => {
          const p = progress[progressKey(t.releaseId, t.lastOrdinal!)]
          const ratio = p ? (p.watched ? 1 : p.duration ? p.time / p.duration : 0) : 0
          return (
            <WideCard
              key={t.releaseId}
              to={watchHref(t.alias, t.lastOrdinal!)}
              image={p?.preview || t.lastPreview || t.poster}
              title={t.name}
              subtitle={`${fmtOrdinal(t.lastOrdinal!)} серия`}
              badge={p?.watched ? 'Просмотрено' : p && p.time > 5 ? fmtTime(p.time) : undefined}
              ratio={ratio}
            />
          )
        })}
      </Row>
    </Section>
  )
}

export default function Home() {
  const latest = useAsync(() => api.latest(24), [])
  const schedule = useAsync(() => api.scheduleWeek(), [])
  const [seed, setSeed] = useState(0)
  const random = useAsync(() => api.random(12), [seed])

  const today = useMemo(() => {
    const d = ((new Date().getDay() + 6) % 7) + 1 // API: 1 = Monday
    return (schedule.data ?? []).filter((s) => Number(s.release.publish_day?.value) === d)
  }, [schedule.data])

  const heroItems = useMemo(() => (latest.data ?? []).filter((r) => r.latest_episode?.preview).slice(0, 6), [latest.data])

  return (
    <div className="flex flex-col gap-10">
      <Hero items={heroItems} />
      <ContinueRow />
      <Section title="Новые серии" action={<Link to="/catalog" className="flex items-center text-sm font-bold text-muted hover:text-white">Каталог <ChevronRight size={16} /></Link>}>
        <Row>
          {latest.data
            ? latest.data.map((r) => (
                <ReleaseCard key={r.id} r={r} sub={r.latest_episode ? `${fmtOrdinal(r.latest_episode.ordinal)} серия · ${r.type?.description ?? ''}` : undefined} />
              ))
            : [<CardSkeletons key="s" n={1} />, <CardSkeletons key="s2" n={1} />, <CardSkeletons key="s3" n={1} />, <CardSkeletons key="s4" n={1} />, <CardSkeletons key="s5" n={1} />, <CardSkeletons key="s6" n={1} />]}
        </Row>
      </Section>
      {today.length > 0 && (
        <Section title="Сегодня выходит" action={<Link to="/schedule" className="flex items-center text-sm font-bold text-muted hover:text-white">Расписание <ChevronRight size={16} /></Link>}>
          <Row>
            {today.map((s) => (
              <ReleaseCard
                key={s.release.id}
                r={s.release}
                sub={s.next_release_episode_number ? `Ждём ${s.next_release_episode_number} серию` : s.published_release_episode ? `Вышла ${fmtOrdinal(s.published_release_episode.ordinal)} серия` : undefined}
              />
            ))}
          </Row>
        </Section>
      )}
      <Section
        title="Случайные тайтлы"
        action={
          <button onClick={() => setSeed((x) => x + 1)} className="flex items-center gap-2 rounded-full bg-card-2 px-4 py-2 text-sm font-bold ring-1 ring-white/5 hover:bg-white/10">
            <Shuffle size={15} /> Ещё
          </button>
        }
      >
        <Row>
          {random.data
            ? random.data.map((r) => <ReleaseCard key={r.id} r={r} />)
            : [<CardSkeletons key="a" n={1} />, <CardSkeletons key="b" n={1} />, <CardSkeletons key="c" n={1} />, <CardSkeletons key="d" n={1} />]}
        </Row>
      </Section>
    </div>
  )
}
