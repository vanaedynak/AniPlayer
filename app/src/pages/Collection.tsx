import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Library, HardDriveDownload, Layers } from 'lucide-react'
import { useStore, releaseProgress, titleHref, LIST_LABELS, LIST_COLORS, type ListStatus, type TitleEntry } from '../lib/store'
import { shikiMeta, useShikiPoster, type ShikiMeta } from '../lib/shikimori'
import { Chip, Empty } from '../components/ui'
import { PlaylistButton } from '../components/Music'

type Tab = ListStatus | 'favorite'

/** every part of one franchise in the collection: Bleach and all its seasons, Naruto with Shippuden and Boruto */
interface Group {
  key: string
  parts: TitleEntry[]
  status: ListStatus | null
  favorite: boolean
  updatedAt: number
}

// the franchise shows under the most "alive" status any of its parts has
const RANK: ListStatus[] = ['watching', 'postponed', 'planned', 'completed', 'dropped']
const byAir = (a: TitleEntry, b: TitleEntry) => (a.year || 9999) - (b.year || 9999) || (a.malId ?? 0) - (b.malId ?? 0)
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many

function groupTitles(entries: TitleEntry[], meta: Record<number, ShikiMeta>): Group[] {
  const map = new Map<string, TitleEntry[]>()
  for (const t of entries) {
    const key = (t.malId && meta[t.malId]?.franchise) || `t${t.releaseId}`
    map.set(key, [...(map.get(key) ?? []), t])
  }
  return [...map].map(([key, parts]) => ({
    key,
    parts: parts.sort(byAir),
    status: RANK.find((s) => parts.some((p) => p.status === s)) ?? null,
    favorite: parts.some((p) => p.favorite),
    updatedAt: Math.max(...parts.map((p) => p.updatedAt)),
  }))
}

function GroupCard({ g }: { g: Group }) {
  const progress = useStore((s) => s.progress)
  const first = g.parts[0]
  const poster = useShikiPoster(first.poster, first.malId)
  const many = g.parts.length > 1
  // the part watched last opens; its page switches between the seasons
  const open = [...g.parts].sort((a, b) => (b.lastWatchedAt ?? 0) - (a.lastWatchedAt ?? 0) || b.updatedAt - a.updatedAt)[0]
  const watched = g.parts.reduce((n, t) => n + releaseProgress(progress, t.releaseId).filter((p) => p.watched).length, 0)
  const done = g.parts.filter((t) => t.status === 'completed').length
  const name = many ? first.name.split(/[:—]|\s-\s|\.\s/)[0].trim() || first.name : first.name
  const years = [...new Set([first.year, g.parts.at(-1)!.year].filter(Boolean))].join('–')
  return (
    <Link to={titleHref(open.alias)} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-card ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-white/15">
        <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        {g.status && (
          <span className="glass absolute top-2 left-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold">
            <span className="h-2 w-2 rounded-full" style={{ background: LIST_COLORS[g.status] }} /> {LIST_LABELS[g.status]}
          </span>
        )}
        {g.favorite && <span className="absolute top-2 right-2 text-pink">♥</span>}
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-1.5">
          {many && (
            <span className="flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-xs font-bold">
              <Layers size={12} /> {g.parts.length} {plural(g.parts.length, 'часть', 'части', 'частей')}
            </span>
          )}
          {watched > 0 && (
            <span className="rounded-lg bg-black/60 px-2 py-1 text-xs font-bold">
              {watched}
              {!many && first.episodesTotal ? ` / ${first.episodesTotal}` : ''} эп.
            </span>
          )}
        </div>
      </div>
      <div className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-bold">{name}</div>
      <div className="mt-0.5 text-xs font-medium text-muted">
        {many ? `просмотрено ${done} из ${g.parts.length}${years ? ` · ${years}` : ''}` : [first.type, first.year].filter(Boolean).join(' · ')}
      </div>
    </Link>
  )
}

export default function Collection() {
  const titles = useStore((s) => s.titles)
  const [tab, setTab] = useState<Tab>('watching')
  const entries = useMemo(() => Object.values(titles).filter((t) => t.status || t.favorite), [titles])
  const ids = useMemo(() => [...new Set(entries.flatMap((t) => (t.malId ? [t.malId] : [])))], [entries])
  const [meta, setMeta] = useState<Record<number, ShikiMeta>>({})
  useEffect(() => {
    let alive = true
    void shikiMeta(ids).then((m) => alive && setMeta({ ...m }))
    return () => {
      alive = false
    }
  }, [ids])
  const groups = useMemo(() => groupTitles(entries, meta), [entries, meta])
  const counts = useMemo(() => {
    const c: Record<string, number> = { favorite: 0 }
    for (const g of groups) {
      if (g.status) c[g.status] = (c[g.status] ?? 0) + 1
      if (g.favorite) c.favorite++
    }
    return c
  }, [groups])
  const list = groups.filter((g) => (tab === 'favorite' ? g.favorite : g.status === tab)).sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Моя коллекция</h1>
        <div className="flex flex-wrap gap-2">
        <Link to="/downloads" className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/15 lg:hidden">
          <HardDriveDownload size={16} /> Загрузки
        </Link>
        <PlaylistButton malIds={[...new Set(Object.values(titles).flatMap((t) => (t.malId && (t.status || t.favorite) ? [t.malId] : [])))]} />
        </div>
      </div>
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {(Object.keys(LIST_LABELS) as ListStatus[]).map((s) => (
          <Chip key={s} active={tab === s} onClick={() => setTab(s)}>
            {LIST_LABELS[s]} <span className="ml-1 opacity-50">{counts[s] ?? 0}</span>
          </Chip>
        ))}
        <Chip active={tab === 'favorite'} onClick={() => setTab('favorite')}>
          ♥ Избранное <span className="ml-1 opacity-50">{counts.favorite}</span>
        </Chip>
      </div>
      {list.length ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {list.map((g) => (
            <GroupCard key={g.key} g={g} />
          ))}
        </div>
      ) : (
        <Empty icon={<Library />} title="Здесь пока пусто" text="Добавляйте тайтлы кнопкой «В коллекцию» на странице аниме. Тайтлы, которые вы начали смотреть, попадают в «Смотрю» автоматически." />
      )}
    </div>
  )
}
