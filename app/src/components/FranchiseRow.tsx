import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Layers, Check, Film } from 'lucide-react'
import { franchiseParts, shikiTitle, type FranchisePart } from '../lib/shikimori'
import { useLibriaIndex } from '../lib/libriaIndex'
import { useStore, LIST_COLORS } from '../lib/store'
import { useAsync } from '../lib/useAsync'
import { cn } from '../lib/format'
import { Row, Section, ShikiCard } from './ui'

/**
 * Seasons of the franchise as tabs above the episodes: picking one shows that season's episodes,
 * with a mark on the parts already watched or in progress.
 */
export function SeasonTabs({ malId }: { malId: number }) {
  const { data } = useAsync(() => franchiseParts(malId), [malId])
  const byMal = useLibriaIndex((s) => s.byMal)
  const titles = useStore((s) => s.titles)
  const nav = useNavigate()
  const loc = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  const [showExtra, setShowExtra] = useState(false)
  const cameFromTabs = !!(loc.state as { seasons?: boolean } | null)?.seasons

  // switching seasons keeps the tabs in view instead of jumping back to the banner
  useEffect(() => {
    if (data && cameFromTabs) setTimeout(() => ref.current?.scrollIntoView({ block: 'start' }), 60)
  }, [data, cameFromTabs, malId])

  if (!data || data.length < 2) return null
  const main = data.filter((p) => p.main)
  const extra = data.filter((p) => !p.main)
  const extraOpen = showExtra || extra.some((p) => p.a.id === malId)
  const entryOf = (id: number) => Object.values(titles).find((t) => t.malId === id)
  const statusOf = (id: number) => entryOf(id)?.status ?? null
  const go = (id: number) => {
    if (id === malId) return
    const l = byMal[id]
    nav(l ? `/title/${l.alias}` : `/anime/${id}`, { replace: true, state: { seasons: true } })
  }
  // the parts of a season ("Сезон 2 · Часть 1…4") are one tab: its page lists them all
  const seasons: FranchisePart[][] = []
  for (const p of main) {
    const name = p.label.split(' · ')[0]
    const last = seasons[seasons.length - 1]
    if (last && last[0].label.split(' · ')[0] === name) last.push(p)
    else seasons.push([p])
  }
  if (seasons.length < 2 && !extra.length) return null
  const seasonChip = (group: FranchisePart[]) => {
    const sts = group.map((p) => statusOf(p.a.id))
    const st = sts.every((x) => x === 'completed') ? 'completed' : (['watching', 'postponed', 'planned', 'completed', 'dropped'] as const).find((x) => sts.includes(x)) ?? null
    // opens the part watched last, or the first one
    const target = [...group].sort((x, y) => (entryOf(y.a.id)?.lastWatchedAt ?? 0) - (entryOf(x.a.id)?.lastWatchedAt ?? 0))[0]
    const pick = group.some((p) => entryOf(p.a.id)?.lastWatchedAt) ? target : group[0]
    return chipFor(group[0].a.id + '', group.some((p) => p.a.id === malId), st, group[0].label.split(' · ')[0], () => !group.some((p) => p.a.id === malId) && go(pick.a.id), group.map((p) => shikiTitle(p.a)).join(' / '))
  }
  const chip = (p: FranchisePart, label: string) => chipFor(p.a.id + '', p.a.id === malId, statusOf(p.a.id), label, () => go(p.a.id), shikiTitle(p.a))
  const chipFor = (key: string, active: boolean, st: ReturnType<typeof statusOf>, label: string, onClick: () => void, title: string) => {
    return (
      <button
        key={key}
        onClick={onClick}
        title={title}
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap transition',
          active ? 'bg-white text-black' : 'bg-card-2 text-white/80 ring-1 ring-white/5 hover:bg-white/10 hover:text-white',
        )}
      >
        {st === 'completed' ? <Check size={14} className={active ? 'text-black' : 'text-lime-400'} /> : st ? <span className="h-2 w-2 rounded-full" style={{ background: LIST_COLORS[st] }} /> : null}
        {label}
      </button>
    )
  }
  return (
    <div ref={ref} className="flex scroll-mt-24 flex-col gap-2">
      <div className="no-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
        {seasons.map(seasonChip)}
        {extra.length > 0 && (
          <button
            onClick={() => setShowExtra((v) => !v)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap ring-1 transition',
              extraOpen ? 'bg-white/15 ring-white/20' : 'ring-white/10 hover:bg-white/10',
            )}
          >
            <Film size={14} /> Фильмы и OVA · {extra.length}
          </button>
        )}
      </div>
      {extraOpen && extra.length > 0 && (
        <div className="no-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
          {extra.map((p) => chip(p, `${p.label} · ${shikiTitle(p.a).split(/[:—]/).slice(1).join(':').trim() || shikiTitle(p.a)}`))}
        </div>
      )}
    </div>
  )
}

/** every season, film and OVA of the franchise, from Shikimori, in airing order */
export function FranchiseRow({ malId, title }: { malId: number; title?: string }) {
  const { data } = useAsync(() => franchiseParts(malId), [malId])
  if (!data || data.length < 2) return null
  const main = data.filter((p) => p.main)
  const extra = data.filter((p) => !p.main)
  const seasons = new Set(main.map((p) => p.label.split(' · ')[0])).size
  return (
    <Section
      title={
        <span className="flex items-center gap-2.5">
          <Layers className="text-accent-2" /> {title ?? 'Все части'}
        </span>
      }
      action={
        <span className="text-sm font-semibold text-muted">
          {[seasons ? `${seasons} сез.` : null, extra.length ? `ещё ${extra.length}` : null].filter(Boolean).join(' · ')}
        </span>
      }
    >
      <div className="flex flex-col gap-6">
        {main.length > 0 && (
          <Row itemClass="w-[150px] sm:w-[170px]">
            {main.map((p) => (
              <ShikiCard key={p.a.id} a={p.a} badge={p.label} active={p.a.id === malId} />
            ))}
          </Row>
        )}
        {extra.length > 0 && (
          <div>
            <div className="mb-3 text-sm font-bold text-muted">Фильмы, OVA, спешлы и спин-оффы</div>
            <Row itemClass="w-[130px] sm:w-[150px]">
              {extra.map((p) => (
                <ShikiCard key={p.a.id} a={p.a} badge={p.label} active={p.a.id === malId} />
              ))}
            </Row>
          </div>
        )}
      </div>
    </Section>
  )
}
