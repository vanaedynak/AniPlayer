import { useMemo, useState } from 'react'
import { Clock, History as HistoryIcon, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useStore, watchHref, type Progress, type TitleEntry } from '../lib/store'
import { WideCard, Empty, Chip } from '../components/ui'
import { fmtTime, fmtOrdinal, cn } from '../lib/format'

function dayLabel(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Сегодня'
  if (d.toDateString() === y.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

export default function History() {
  const progress = useStore((s) => s.progress)
  const titles = useStore((s) => s.titles)
  const removeFromHistory = useStore((s) => s.removeFromHistory)
  const [mode, setMode] = useState<'episodes' | 'titles'>('episodes')

  const groups = useMemo(() => {
    const list: { p: Progress; t: TitleEntry }[] = []
    for (const p of Object.values(progress)) {
      const t = titles[p.releaseId]
      if (!t || !t.lastWatchedAt || (p.time < 5 && !p.watched)) continue
      list.push({ p, t })
    }
    list.sort((a, b) => b.p.updatedAt - a.p.updatedAt)
    const out: { label: string; items: typeof list }[] = []
    for (const it of list.slice(0, 300)) {
      const label = dayLabel(it.p.updatedAt)
      if (out.at(-1)?.label !== label) out.push({ label, items: [] })
      out.at(-1)!.items.push(it)
    }
    return out
  }, [progress, titles])

  const byTitle = useMemo(
    () =>
      Object.values(titles)
        .filter((t) => t.lastWatchedAt)
        .sort((a, b) => b.lastWatchedAt! - a.lastWatchedAt!),
    [titles],
  )

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06] ring-1 ring-white/5">
            <Clock />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Недавно просмотренное</h1>
        </div>
        <div className="flex gap-2">
          <Chip active={mode === 'episodes'} onClick={() => setMode('episodes')}>
            Серии
          </Chip>
          <Chip active={mode === 'titles'} onClick={() => setMode('titles')}>
            Тайтлы
          </Chip>
        </div>
      </div>

      {byTitle.length === 0 ? (
        <Empty
          icon={<HistoryIcon />}
          title="История пуста"
          text="Всё, что вы посмотрите на компьютере или iPad, появится здесь."
          action={
            <Link to="/catalog" className="rounded-full bg-white px-5 py-2.5 font-bold text-black">
              Открыть каталог
            </Link>
          }
        />
      ) : mode === 'episodes' ? (
        groups.map((g) => (
          <section key={g.label} className="animate-fade-up">
            <h2 className="mb-4 text-lg font-extrabold text-white/70">{g.label}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map(({ p, t }) => (
                <WideCard
                  key={`${p.releaseId}_${p.ordinal}`}
                  to={watchHref(t.alias, p.ordinal)}
                  image={p.preview || t.poster}
                  title={t.name}
                  subtitle={`${fmtOrdinal(p.ordinal)} серия · ${new Date(p.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`}
                  badge={p.watched ? 'Просмотрено' : fmtTime(p.time)}
                  ratio={p.watched ? 1 : p.duration ? p.time / p.duration : 0}
                />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {byTitle.map((t) => (
            <div key={t.releaseId} className="group relative">
              <WideCard
                to={watchHref(t.alias, t.lastOrdinal ?? 1)}
                image={t.lastPreview || t.poster}
                title={t.name}
                subtitle={`${fmtOrdinal(t.lastOrdinal ?? 1)} серия${t.episodesTotal ? ` из ${t.episodesTotal}` : ''}`}
              />
              <button
                onClick={() => removeFromHistory(t.releaseId)}
                title="Убрать из истории"
                className={cn('glass absolute top-3 left-3 flex h-9 w-9 items-center justify-center rounded-full opacity-0 transition group-hover:opacity-100 hover:text-rose-400')}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
