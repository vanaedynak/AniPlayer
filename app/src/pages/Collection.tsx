import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Library, HardDriveDownload } from 'lucide-react'
import { useStore, releaseProgress, titleHref, LIST_LABELS, LIST_COLORS, type ListStatus, type TitleEntry } from '../lib/store'
import { Chip, Empty } from '../components/ui'
import { PlaylistButton } from '../components/Music'

type Tab = ListStatus | 'favorite'

function EntryCard({ t }: { t: TitleEntry }) {
  const progress = useStore((s) => s.progress)
  const watched = releaseProgress(progress, t.releaseId).filter((p) => p.watched).length
  return (
    <Link to={titleHref(t.alias)} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-card ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-white/15">
        <img src={t.poster} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        {t.status && (
          <span className="glass absolute top-2 left-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold">
            <span className="h-2 w-2 rounded-full" style={{ background: LIST_COLORS[t.status] }} /> {LIST_LABELS[t.status]}
          </span>
        )}
        {t.favorite && <span className="absolute top-2 right-2 text-pink">♥</span>}
        {watched > 0 && (
          <span className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2 py-1 text-xs font-bold">
            {watched}
            {t.episodesTotal ? ` / ${t.episodesTotal}` : ''} эп.
          </span>
        )}
      </div>
      <div className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-bold">{t.name}</div>
      <div className="mt-0.5 text-xs font-medium text-muted">{[t.type, t.year].filter(Boolean).join(' · ')}</div>
    </Link>
  )
}

export default function Collection() {
  const titles = useStore((s) => s.titles)
  const [tab, setTab] = useState<Tab>('watching')
  const counts = useMemo(() => {
    const c: Record<string, number> = { favorite: 0 }
    for (const t of Object.values(titles)) {
      if (t.status) c[t.status] = (c[t.status] ?? 0) + 1
      if (t.favorite) c.favorite++
    }
    return c
  }, [titles])
  const list = Object.values(titles)
    .filter((t) => (tab === 'favorite' ? t.favorite : t.status === tab))
    .sort((a, b) => b.updatedAt - a.updatedAt)

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
          {list.map((t) => (
            <EntryCard key={t.releaseId} t={t} />
          ))}
        </div>
      ) : (
        <Empty icon={<Library />} title="Здесь пока пусто" text="Добавляйте тайтлы кнопкой «В коллекцию» на странице аниме. Тайтлы, которые вы начали смотреть, попадают в «Смотрю» автоматически." />
      )}
    </div>
  )
}
