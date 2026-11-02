import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRing, CalendarDays, Loader2, RefreshCw, X } from 'lucide-react'
import { useManga } from './store'
import { useUpdates, checkUpdates, forecast, titlePath, readPath } from './updates'
import { coverUrl } from './md'
import { Cover } from './ui'
import { Section } from '../components/ui'
import { isNovelEntry } from '../ranobe/shelf'
import { cn, relTime } from '../lib/format'

type Kind = 'manga' | 'novel'
const ofKind = (id: string, kind: Kind) => isNovelEntry(id) === (kind === 'novel')

/** "Новые главы": what came out of the titles being read since the reader last looked */
export function NewChapters({ kind }: { kind: Kind }) {
  const fresh = useUpdates((s) => s.fresh)
  const checkedAt = useUpdates((s) => s.checkedAt)
  const entries = useManga((s) => s.entries)
  const [busy, setBusy] = useState(false)
  const rows = useMemo(
    () =>
      Object.entries(fresh)
        .filter(([id]) => ofKind(id, kind) && entries[id])
        .map(([id, f]) => ({ e: entries[id], left: f.chapters.filter((c) => !entries[id].read.includes(c.key)), at: f.at }))
        .filter((r) => r.left.length)
        .sort((a, b) => b.at - a.at),
    [fresh, entries, kind],
  )
  const refresh = () => {
    setBusy(true)
    void checkUpdates(true).finally(() => setBusy(false))
  }
  const followed = Object.values(entries).some((e) => ofKind(e.id, kind) && (e.favorite || e.status === 'reading' || e.lastChapterId))
  if (!followed) return null
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <BellRing size={20} className="text-accent-2" /> Новые главы
        </span>
      }
      action={
        <button onClick={refresh} disabled={busy} className="flex items-center gap-1.5 text-sm font-bold text-muted hover:text-white" title="Проверить сейчас">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {checkedAt ? `проверено ${relTime(checkedAt)}` : 'проверить'}
        </button>
      }
    >
      {rows.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map(({ e, left }) => {
            const first = left[left.length - 1]
            return (
              <div key={e.id} className="flex items-center gap-4 rounded-2xl bg-card/80 p-3 ring-1 ring-white/[0.04]">
                <Link to={titlePath(e.id)}>
                  <Cover src={isNovelEntry(e.id) ? e.cover : coverUrl(e)} className="h-20 w-14 shrink-0 rounded-xl" />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={titlePath(e.id)} className="line-clamp-1 font-extrabold hover:underline">
                    {e.title}
                  </Link>
                  <div className="text-sm font-bold text-accent-2">
                    {left.length === 1 ? 'Вышла новая глава' : `Новых глав: ${left.length}`}
                  </div>
                  <div className="truncate text-xs text-dim">{left.slice(0, 3).map((c) => c.label).join(' · ')}</div>
                </div>
                <Link to={readPath(e.id, first.id)} className="flex h-10 shrink-0 items-center rounded-full bg-white px-4 text-sm font-bold text-black">
                  Читать
                </Link>
                <button onClick={() => useUpdates.getState().dismiss(e.id)} title="Скрыть" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white">
                  <X size={16} />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-2xl bg-card/60 px-5 py-4 text-sm text-muted ring-1 ring-white/[0.04]">
          Пока ничего нового. Приложение само проверяет главы того, что вы читаете и отметили звёздочкой, каждые несколько часов.
        </div>
      )}
    </Section>
  )
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DAY_NAMES = ['понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям']

/** "Когда ждать главы": a week ahead, each title on the day its next chapter is likely */
export function ReadingSchedule({ kind }: { kind: Kind }) {
  const days = useUpdates((s) => s.days)
  const entries = useManga((s) => s.entries)
  const week = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const cols = Array.from({ length: 7 }, (_, i) => ({ at: start.getTime() + i * 86_400_000, items: [] as { id: string; title: string; cover: string; note: string }[] }))
    for (const [id, times] of Object.entries(days)) {
      const e = entries[id]
      if (!e || !ofKind(id, kind)) continue
      const f = forecast(times)
      if (!f) continue
      const col = cols.find((c) => c.at === f.next)
      if (!col) continue
      col.items.push({
        id,
        title: e.title,
        cover: isNovelEntry(id) ? e.cover : coverUrl(e),
        note: f.weekday != null ? `обычно по ${DAY_NAMES[f.weekday]}` : f.every === 1 ? 'почти каждый день' : `примерно раз в ${f.every} дн.`,
      })
    }
    return cols
  }, [days, entries, kind])
  if (!week.some((c) => c.items.length)) return null
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <CalendarDays size={20} className="text-accent-2" /> Когда ждать главы
        </span>
      }
    >
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-7 sm:px-0">
        {week.map((c, i) => {
          const d = new Date(c.at)
          return (
            <div key={c.at} className={cn('flex w-40 shrink-0 flex-col gap-2 rounded-2xl bg-card/70 p-3 ring-1 ring-white/[0.04] sm:w-auto', i === 0 && 'ring-accent/40')}>
              <div className="text-xs font-extrabold tracking-wide text-muted uppercase">
                {i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : DAYS[(d.getDay() + 6) % 7]} · {d.getDate()}
              </div>
              {c.items.length ? (
                c.items.map((it) => (
                  <Link key={it.id} to={titlePath(it.id)} className="group flex items-center gap-2" title={it.note}>
                    <Cover src={it.cover} className="h-12 w-9 shrink-0 rounded-lg" />
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-xs font-bold group-hover:underline">{it.title}</div>
                      <div className="truncate text-[10px] text-dim">{it.note}</div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-xs text-dim">—</div>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-2 text-xs text-dim">Прогноз по тому, как выходили прошлые главы: точной даты переводчики не объявляют.</div>
    </Section>
  )
}
