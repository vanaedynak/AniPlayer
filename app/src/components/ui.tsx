import { useRef, useState, useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Star, Check, Play } from 'lucide-react'
import { posterUrl, episodePreview, type Release, type Episode } from '../lib/api'
import { useStore, progressKey, releaseProgress } from '../lib/store'
import { fmtTime, fmtOrdinal, cn } from '../lib/format'
import { shImg, shikiTitle, KINDS, type ShikiAnime } from '../lib/shikimori'
import { useLibriaIndex } from '../lib/libriaIndex'

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('animate-fade-up', className)}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** horizontal scroller with arrow buttons on desktop and momentum swipe on iPad */
export function Row({ children, itemClass = 'w-[160px] sm:w-[190px]' }: { children: ReactNode[]; itemClass?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ l: false, r: true })
  const update = () => {
    const el = ref.current
    if (!el) return
    setEdges({ l: el.scrollLeft > 8, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 8 })
  }
  useEffect(update, [children.length])
  const by = (d: number) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  return (
    <div className="group/row relative -mx-4 sm:-mx-2">
      <div ref={ref} onScroll={update} className="no-scrollbar flex snap-x gap-4 overflow-x-auto scroll-smooth px-4 pb-2 sm:px-2">
        {children.map((c, i) => (
          <div key={i} className={cn('shrink-0 snap-start', itemClass)}>
            {c}
          </div>
        ))}
      </div>
      {edges.l && (
        <button
          onClick={() => by(-1)}
          className="glass absolute top-[38%] left-1 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full opacity-0 ring-1 ring-white/10 transition group-hover/row:opacity-100 lg:flex"
        >
          <ChevronLeft />
        </button>
      )}
      {edges.r && (
        <button
          onClick={() => by(1)}
          className="glass absolute top-[38%] right-1 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full opacity-0 ring-1 ring-white/10 transition group-hover/row:opacity-100 lg:flex"
        >
          <ChevronRight />
        </button>
      )}
    </div>
  )
}

export function ReleaseCard({ r, sub }: { r: Release; sub?: string }) {
  const entry = useStore((s) => s.titles[r.id])
  const progress = useStore((s) => s.progress)
  const watchedCount = entry ? releaseProgress(progress, r.id).filter((p) => p.watched).length : 0
  const total = r.episodes_total || 0
  const rating = r.mal?.rating ?? r.shikimori?.rating
  return (
    <Link to={`/title/${r.alias}`} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-card ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-2xl group-hover:shadow-accent/15 group-hover:ring-white/15">
        <img
          src={posterUrl(r)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-80" />
        <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
          {rating ? (
            <span className="glass flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold">
              <Star size={12} className="fill-yellow-400 text-yellow-400" /> {rating.toFixed(1)}
            </span>
          ) : null}
          {r.is_ongoing && <span className="rounded-lg bg-accent px-2 py-1 text-xs font-bold">Онгоинг</span>}
        </div>
        {entry?.favorite && <span className="absolute top-2 right-2 text-pink">♥</span>}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-black shadow-xl">
            <Play fill="currentColor" className="ml-1" />
          </span>
        </div>
        {watchedCount > 0 && total > 0 && (
          <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-white/20">
            <div className="h-full bg-accent-2" style={{ width: `${Math.min(100, (watchedCount / total) * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-bold">{r.name.main}</div>
      <div className="mt-0.5 text-xs font-medium text-muted">
        {sub ?? [r.type?.description, r.year, r.episodes_total ? `${r.episodes_total} эп.` : null].filter(Boolean).join(' · ')}
      </div>
    </Link>
  )
}

/** wide 16:9 card used for "continue watching" and history, Animix style */
export function WideCard({
  to,
  image,
  title,
  subtitle,
  badge,
  ratio,
  className,
}: {
  to: string
  image: string
  title: string
  subtitle: string
  badge?: string
  ratio?: number
  className?: string
}) {
  return (
    <Link to={to} className={cn('group relative block aspect-video overflow-hidden rounded-3xl bg-card ring-1 ring-white/5', className)}>
      <img src={image} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
      {badge && <span className="glass absolute top-3 right-3 rounded-full px-3 py-1 text-sm font-semibold">{badge}</span>}
      <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
        <div className="text-sm font-medium text-white/80">{subtitle}</div>
        <div className="line-clamp-1 text-lg font-extrabold sm:text-xl">{title}</div>
      </div>
      {ratio != null && ratio > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
          <div className="h-full bg-accent-2" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-black shadow-xl">
          <Play fill="currentColor" className="ml-1" />
        </span>
      </div>
    </Link>
  )
}

export function EpisodeCard({ r, e, active, onClick }: { r: Release; e: Episode; active?: boolean; onClick?: () => void }) {
  const p = useStore((s) => s.progress[progressKey(r.id, e.ordinal)])
  const dur = p?.duration || e.duration || 0
  const ratio = p ? (p.watched ? 1 : dur ? p.time / dur : 0) : 0
  const body = (
    <>
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-card ring-1 ring-white/5">
        {episodePreview(e) ? (
          <img src={episodePreview(e)} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        ) : (
          <img src={posterUrl(r)} alt="" loading="lazy" className="h-full w-full object-cover opacity-40 blur-sm" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
        {active && <div className="absolute inset-0 rounded-2xl ring-2 ring-accent-2 ring-inset" />}
        {p?.watched ? (
          <span className="glass absolute top-2 right-2 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold">
            <Check size={13} /> Просмотрено
          </span>
        ) : p && p.time > 5 ? (
          <span className="glass absolute top-2 right-2 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums">{fmtTime(p.time)}</span>
        ) : e.duration ? (
          <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold tabular-nums">{fmtTime(e.duration)}</span>
        ) : null}
        {active && (
          <span className="absolute top-2 left-2 rounded-full bg-accent px-2.5 py-1 text-xs font-bold">Сейчас</span>
        )}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="text-[17px] font-extrabold">Серия {fmtOrdinal(e.ordinal)}</div>
          {e.name && <div className="line-clamp-1 text-xs font-medium text-white/70">{e.name}</div>}
        </div>
        {ratio > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
            <div className={cn('h-full', p?.watched ? 'bg-white/50' : 'bg-accent-2')} style={{ width: `${ratio * 100}%` }} />
          </div>
        )}
      </div>
    </>
  )
  if (onClick)
    return (
      <button onClick={onClick} className={cn('group block w-full text-left', p?.watched && !active && 'opacity-80')}>
        {body}
      </button>
    )
  return (
    <Link to={`/watch/${r.alias}/${e.ordinal}`} className={cn('group block', p?.watched && 'opacity-80')}>
      {body}
    </Link>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-2xl', className)} />
}

export function CardSkeletons({ n = 8, wide }: { n?: number; wide?: boolean }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i}>
          <Skeleton className={wide ? 'aspect-video rounded-3xl' : 'aspect-[2/3]'} />
          {!wide && <Skeleton className="mt-2.5 h-4 w-3/4 rounded-md" />}
        </div>
      ))}
    </>
  )
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap transition',
        active ? 'bg-white text-black' : 'bg-card-2 text-white/80 ring-1 ring-white/5 hover:bg-white/10 hover:text-white',
      )}
    >
      {children}
    </button>
  )
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 px-6 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-card-2 text-accent-2">{icon}</div>
      <div className="text-lg font-bold">{title}</div>
      {text && <div className="mt-1 max-w-sm text-sm text-muted">{text}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-[28px] border border-white/[0.06] bg-card/80 p-5 sm:p-7', className)}>{children}</div>
}

export function PanelTitle({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div className="mb-5 flex items-center gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] ring-1 ring-white/5">{icon}</div>
      <div>
        <div className="text-xl font-extrabold sm:text-2xl">{title}</div>
        {sub && <div className="text-sm font-semibold text-muted">{sub}</div>}
      </div>
    </div>
  )
}

/** card for a Shikimori entry; marks titles AniLibria has voiced */
export function ShikiCard({ a }: { a: ShikiAnime }) {
  const libria = useLibriaIndex((s) => s.byMal[a.id])
  return (
    <Link to={libria ? `/title/${libria.alias}` : `/anime/${a.id}`} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-card ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-2xl group-hover:shadow-accent/15 group-hover:ring-white/15">
        <img src={shImg(a.image.original)} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-80" />
        <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
          {Number(a.score) > 0 && (
            <span className="glass flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold">
              <Star size={12} className="fill-yellow-400 text-yellow-400" /> {a.score}
            </span>
          )}
          {a.status === 'ongoing' && <span className="rounded-lg bg-accent px-2 py-1 text-xs font-bold">Онгоинг</span>}
        </div>
        {libria && <span className="absolute right-2 bottom-2 rounded-lg bg-white px-2 py-1 text-[11px] font-extrabold text-black">AniLibria</span>}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-black shadow-xl">
            <Play fill="currentColor" className="ml-1" />
          </span>
        </div>
      </div>
      <div className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-bold">{shikiTitle(a)}</div>
      <div className="mt-0.5 text-xs font-medium text-muted">
        {[a.kind ? KINDS[a.kind] ?? a.kind : null, a.aired_on?.slice(0, 4), a.episodes ? `${a.episodes} эп.` : null].filter(Boolean).join(' · ')}
      </div>
    </Link>
  )
}
