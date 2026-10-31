import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { BookOpen, Star } from 'lucide-react'
import { coverUrl, mangaName, KIND, STATUS, type Manga } from './md'
import { useManga, type MangaEntry } from './store'
import { cn } from '../lib/format'

/** cover with a soft fallback: some MangaDex titles have no cover art */
export function Cover({ src, className, children }: { src: string; className?: string; children?: ReactNode }) {
  const [bad, setBad] = useState(false)
  return (
    <div className={cn('relative overflow-hidden bg-card', className)}>
      {src && !bad ? (
        <img src={src} alt="" loading="lazy" onError={() => setBad(true)} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/30 to-pink/20 text-white/50">
          <BookOpen size={36} />
        </div>
      )}
      {children}
    </div>
  )
}

export function MangaCard({ m, score }: { m: Manga; score?: number | null }) {
  const entry = useManga((s) => s.entries[m.id])
  return (
    <Link to={`/manga/${m.id}`} className="group block">
      <Cover
        src={coverUrl(m)}
        className="aspect-[2/3] rounded-2xl ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-2xl group-hover:shadow-accent/15 group-hover:ring-white/15"
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-80" />
        <div className="absolute top-2 left-2 flex flex-wrap gap-1.5">
          {score ? (
            <span className="glass flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold">
              <Star size={12} className="fill-yellow-400 text-yellow-400" /> {score.toFixed(1)}
            </span>
          ) : null}
          {m.status === 'ongoing' && <span className="rounded-lg bg-accent px-2 py-1 text-xs font-bold">Выходит</span>}
        </div>
        {m.langs.includes('ru') && <span className="absolute right-2 bottom-2 rounded-lg bg-white px-2 py-1 text-[11px] font-extrabold text-black">RU</span>}
        {entry?.lastLabel && <span className="absolute bottom-2 left-2 rounded-lg bg-black/70 px-2 py-1 text-[11px] font-extrabold backdrop-blur">{entry.lastLabel.replace(/^Том \S+ · /, '')}</span>}
      </Cover>
      <div className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-bold">{mangaName(m)}</div>
      <div className="mt-0.5 text-xs font-medium text-muted">{[KIND(m.lang), m.year, STATUS[m.status]].filter(Boolean).join(' · ')}</div>
    </Link>
  )
}

/** shelf entry card (works offline: everything it needs is in the store) */
export function EntryCard({ e }: { e: MangaEntry }) {
  const pct = e.lastPages ? ((e.lastPage ?? 0) + 1) / e.lastPages : 0
  return (
    <Link to={e.lastChapterId ? `/manga/read/${e.id}/${e.lastChapterId}` : `/manga/${e.id}`} className="group block">
      <Cover src={e.cover ? `${e.cover}.256.jpg` : ''} className="aspect-[2/3] rounded-2xl ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-white/15">
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        {e.lastLabel && (
          <div className="absolute inset-x-2 bottom-2">
            <div className="mb-1.5 text-[11px] font-extrabold">{e.lastLabel.replace(/^Том \S+ · /, '')}</div>
            <div className="h-1 overflow-hidden rounded-full bg-white/20">
              <div className="h-full bg-accent-2" style={{ width: `${Math.min(100, pct * 100)}%` }} />
            </div>
          </div>
        )}
      </Cover>
      <div className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-bold">{e.title}</div>
      <div className="mt-0.5 text-xs font-medium text-muted">{e.kind}</div>
    </Link>
  )
}

/** Манга | Ранобэ switch at the top of the reading section */
export function ReadTabs() {
  return (
    <div className="flex gap-1 self-start rounded-full bg-card-2 p-1 ring-1 ring-white/5">
      {[
        { to: '/manga', label: 'Манга' },
        { to: '/ranobe', label: 'Ранобэ' },
      ].map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          className={({ isActive }) => cn('rounded-full px-5 py-2 text-sm font-bold transition', isActive ? 'bg-white text-black' : 'text-white/70 hover:text-white')}
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}

/** colors for the reader backgrounds */
export const PAPER = {
  dark: { bg: '#101016', fg: '#e8e8ee', sub: '#9b9bab', label: 'Тёмная' },
  black: { bg: '#000000', fg: '#d6d6dc', sub: '#8a8a96', label: 'Чёрная' },
  sepia: { bg: '#f4ecd8', fg: '#433422', sub: '#8a7558', label: 'Сепия' },
  light: { bg: '#ffffff', fg: '#1a1a1f', sub: '#6b6b7b', label: 'Светлая' },
} as const
