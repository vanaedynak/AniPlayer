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
  const statusOf = (id: number) => Object.values(titles).find((t) => t.malId === id && t.status)?.status ?? null
  const go = (id: number) => {
    if (id === malId) return
    const l = byMal[id]
    nav(l ? `/title/${l.alias}` : `/anime/${id}`, { replace: true, state: { seasons: true } })
  }
  const chip = (p: FranchisePart, label: string) => {
    const st = statusOf(p.a.id)
    const active = p.a.id === malId
    return (
      <button
        key={p.a.id}
        onClick={() => go(p.a.id)}
        title={shikiTitle(p.a)}
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
        {main.map((p) => chip(p, p.label))}
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
