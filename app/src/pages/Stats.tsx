import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Flame, Trophy, ArrowRight } from 'lucide-react'
import { useStore, dayKey, titleHref, LIST_LABELS, LIST_COLORS, type ListStatus } from '../lib/store'
import { Panel, PanelTitle } from '../components/ui'
import { cn, plural } from '../lib/format'

function Donut({ parts }: { parts: { value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0)
  const R = 15.9155
  let acc = 0
  return (
    <svg viewBox="0 0 42 42" className="h-40 w-40 -rotate-90">
      <circle cx="21" cy="21" r={R} fill="none" stroke="#ffffff10" strokeWidth="6" />
      {total > 0 &&
        parts.map((p, i) => {
          const pct = (p.value / total) * 100
          const el = (
            <circle
              key={i}
              cx="21"
              cy="21"
              r={R}
              fill="none"
              stroke={p.color}
              strokeWidth="6"
              strokeDasharray={`${Math.max(0, pct - 0.6)} ${100 - pct + 0.6}`}
              strokeDashoffset={-acc}
            />
          )
          acc += pct
          return el
        })}
    </svg>
  )
}

function Activity({ days }: { days: Record<string, number> }) {
  const data = useMemo(() => {
    const out: { key: string; label: string; h: number; weekday: number }[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      out.push({ key: dayKey(d), label: d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }), h: (days[dayKey(d)] ?? 0) / 3600, weekday: d.getDay() })
    }
    return out
  }, [days])
  const max = Math.max(1, ...data.map((d) => d.h))
  return (
    <div>
      <div className="flex h-40 items-end gap-[3px] sm:gap-1.5">
        {data.map((d, i) => (
          <div key={d.key} className="group relative flex h-full flex-1 items-end">
            <div
              className={cn('w-full rounded-md transition-all group-hover:opacity-100', i === data.length - 1 ? 'bg-accent-2' : 'bg-accent/70 opacity-80')}
              style={{ height: `${Math.max(d.h > 0 ? 4 : 1.5, (d.h / max) * 100)}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-lg bg-black/90 px-2 py-1 text-xs font-bold whitespace-nowrap opacity-0 transition group-hover:opacity-100">
              {d.label}: {d.h < 1 ? `${Math.round(d.h * 60)} мин` : `${d.h.toFixed(1)} ч`}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs font-semibold text-dim">
        <span>{data[0].label}</span>
        <span>сегодня</span>
      </div>
    </div>
  )
}

export default function Stats() {
  const days = useStore((s) => s.statsDays)
  const progress = useStore((s) => s.progress)
  const titles = useStore((s) => s.titles)

  const s = useMemo(() => {
    const totalSec = Object.values(days).reduce((a, b) => a + b, 0)
    let week = 0
    for (let i = 0; i < 7; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      week += days[dayKey(d)] ?? 0
    }
    // longest streak of consecutive days with at least 5 minutes
    let streak = 0
    for (let i = 0; ; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      if ((days[dayKey(d)] ?? 0) >= 300) streak++
      else if (i > 0) break
      if (i > 3650) break
    }
    const episodes = Object.values(progress).filter((p) => p.watched).length
    const statusCounts: Record<ListStatus, number> = { watching: 0, planned: 0, completed: 0, postponed: 0, dropped: 0 }
    for (const t of Object.values(titles)) if (t.status) statusCounts[t.status]++
    const perTitle = new Map<number, number>()
    for (const p of Object.values(progress)) if (p.watched) perTitle.set(p.releaseId, (perTitle.get(p.releaseId) ?? 0) + 1)
    const top = [...perTitle.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => ({ t: titles[id], n }))
      .filter((x) => x.t)
    return { hours: totalSec / 3600, week: week / 3600, streak, episodes, statusCounts, top, titlesCount: perTitle.size }
  }, [days, progress, titles])

  const fmtH = (h: number) => (h >= 100 ? h.toFixed(0) : h.toFixed(1))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Статистика</h1>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Panel>
          <PanelTitle icon={<BarChart3 />} title="Статистика просмотра" />
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3 rounded-3xl bg-gradient-to-br from-accent/45 to-accent-3/20 p-6 ring-1 ring-accent/30">
                <div className="text-5xl font-extrabold tracking-tight tabular-nums">{fmtH(s.hours)}</div>
                <div className="mt-1 text-sm font-bold text-white/70">{plural(Math.round(s.hours), 'час', 'часа', 'часов')} просмотра</div>
              </div>
              <Stat value={String(s.episodes)} label={plural(s.episodes, 'серия', 'серии', 'серий')} />
              <Stat value={fmtH(s.week)} label="часов за неделю" />
              <Stat value={String(s.titlesCount)} label={plural(s.titlesCount, 'тайтл', 'тайтла', 'тайтлов')} />
            </div>
            <div className="flex items-center justify-center gap-6 rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/5">
              <Donut parts={(Object.keys(LIST_LABELS) as ListStatus[]).map((k) => ({ value: s.statusCounts[k], color: LIST_COLORS[k] }))} />
              <div className="flex flex-col gap-2">
                {(Object.keys(LIST_LABELS) as ListStatus[]).map((k) => (
                  <div key={k} className="flex items-center gap-2 text-sm font-bold">
                    <span className="h-3 w-3 rounded" style={{ background: LIST_COLORS[k] }} />
                    {LIST_LABELS[k]} <span className="text-dim">{s.statusCounts[k]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Link to="/collection" className="mt-4 flex items-center justify-between rounded-2xl bg-white/[0.04] px-5 py-4 font-bold ring-1 ring-white/5 hover:bg-white/[0.08]">
            Смотреть коллекции <ArrowRight size={18} />
          </Link>
        </Panel>

        <Panel>
          <PanelTitle icon={<Flame className="text-orange-400" />} title={`${s.streak} ${plural(s.streak, 'день', 'дня', 'дней')} подряд`} sub="серия дней с просмотром" />
          <div className="mb-2 text-sm font-bold text-muted">Активность за 30 дней</div>
          <Activity days={days} />
        </Panel>
      </div>

      {s.top.length > 0 && (
        <Panel>
          <PanelTitle icon={<Trophy className="text-yellow-400" />} title="Больше всего серий" />
          <div className="flex flex-col gap-2">
            {s.top.map(({ t, n }, i) => (
              <Link key={t.releaseId} to={titleHref(t.alias)} className="flex items-center gap-4 rounded-2xl p-2 hover:bg-white/5">
                <span className="w-6 text-center text-lg font-extrabold text-dim">{i + 1}</span>
                <img src={t.poster} alt="" className="h-16 w-11 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{t.name}</div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-accent-2" style={{ width: `${t.episodesTotal ? Math.min(100, (n / t.episodesTotal) * 100) : 100}%` }} />
                  </div>
                </div>
                <span className="text-sm font-bold text-muted">
                  {n}
                  {t.episodesTotal ? ` / ${t.episodesTotal}` : ''}
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-3xl bg-white/[0.04] p-5 ring-1 ring-white/5">
      <div className="text-3xl font-extrabold tabular-nums">{value}</div>
      <div className="mt-1 text-xs font-bold text-muted">{label}</div>
    </div>
  )
}
