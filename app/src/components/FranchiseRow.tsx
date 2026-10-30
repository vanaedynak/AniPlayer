import { Layers } from 'lucide-react'
import { franchiseParts } from '../lib/shikimori'
import { useAsync } from '../lib/useAsync'
import { Row, Section, ShikiCard } from './ui'

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
