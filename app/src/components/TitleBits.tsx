import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Heart, Check, Plus, Layers } from 'lucide-react'
import { api, posterUrl, type Release } from '../lib/api'
import { useStore, LIST_LABELS, LIST_COLORS, type ListStatus } from '../lib/store'
import { useAsync } from '../lib/useAsync'
import { cn } from '../lib/format'

export function StatusPicker({ r }: { r: Release }) {
  const entry = useStore((s) => s.titles[r.id])
  const setStatus = useStore((s) => s.setStatus)
  const toggleFavorite = useStore((s) => s.toggleFavorite)
  const [open, setOpen] = useState(false)
  const status = entry?.status ?? null
  return (
    <div className="flex gap-2">
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="flex h-12 items-center gap-2 rounded-full bg-white/10 px-5 font-bold ring-1 ring-white/10 transition hover:bg-white/15"
        >
          {status ? (
            <>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: LIST_COLORS[status] }} />
              {LIST_LABELS[status]}
            </>
          ) : (
            <>
              <Plus size={18} /> В коллекцию
            </>
          )}
          <ChevronDown size={16} className={cn('transition', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="animate-pop glass absolute top-14 left-0 z-30 w-56 rounded-2xl p-1.5 shadow-2xl ring-1 ring-white/10">
            {(Object.keys(LIST_LABELS) as ListStatus[]).map((s) => (
              <button
                key={s}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setStatus(r, status === s ? null : s)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-semibold hover:bg-white/10"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: LIST_COLORS[s] }} />
                <span className="flex-1">{LIST_LABELS[s]}</span>
                {status === s && <Check size={16} />}
              </button>
            ))}
            {status && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setStatus(r, null)
                  setOpen(false)
                }}
                className="mt-1 w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-rose-400 hover:bg-white/10"
              >
                Убрать из коллекции
              </button>
            )}
          </div>
        )}
      </div>
      <button
        onClick={() => toggleFavorite(r)}
        title="Избранное"
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full ring-1 transition',
          entry?.favorite ? 'bg-pink/20 text-pink ring-pink/40' : 'bg-white/10 ring-white/10 hover:bg-white/15',
        )}
      >
        <Heart size={20} className={entry?.favorite ? 'fill-current' : ''} />
      </button>
    </div>
  )
}

export function Franchise({ r }: { r: Release }) {
  const { data } = useAsync(() => api.franchiseOf(r.id), [r.id])
  const f = data?.[0]
  if (!f || f.franchise_releases.length < 2) return null
  const items = [...f.franchise_releases].sort((a, b) => a.sort_order - b.sort_order)
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-lg font-extrabold">
        <Layers size={20} className="text-accent-2" /> Франшиза · {items.length}
      </div>
      <div className="flex flex-col gap-2">
        {items.map((fr) => (
          <Link
            key={fr.id}
            to={`/title/${fr.release.alias}`}
            className={cn(
              'flex items-center gap-3 rounded-2xl p-2 transition',
              fr.release_id === r.id ? 'bg-white/10 ring-1 ring-white/10' : 'hover:bg-white/5',
            )}
          >
            <img src={posterUrl(fr.release, 'thumbnail')} alt="" className="h-16 w-11 shrink-0 rounded-lg object-cover" />
            <div className="min-w-0">
              <div className="line-clamp-2 text-sm leading-snug font-bold">{fr.release.name.main}</div>
              <div className="text-xs font-semibold text-muted">
                {[fr.release.type?.description, fr.release.year, fr.release.episodes_total ? `${fr.release.episodes_total} эп.` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
