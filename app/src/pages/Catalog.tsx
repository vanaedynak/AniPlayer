import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SlidersHorizontal, X, Loader2, SearchX } from 'lucide-react'
import { api, SORTINGS, TYPES, SEASONS, type Release, type CatalogParams } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { ReleaseCard, CardSkeletons, Chip, Empty } from '../components/ui'
import { cn } from '../lib/format'
import ShikiCatalog from './ShikiCatalog'

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-11 appearance-none rounded-full bg-card-2 bg-[length:16px] bg-[right_14px_center] bg-no-repeat pr-10 pl-4 text-sm font-bold ring-1 ring-white/5 outline-none hover:bg-white/10',
        !value && 'text-white/60',
      )}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23aaa' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function SourceTabs() {
  const [sp, setSp] = useSearchParams()
  const all = sp.get('src') === 'all'
  return (
    <div className="flex gap-1 self-start rounded-full bg-card-2 p-1 ring-1 ring-white/5">
      {[
        { v: '', label: 'AniLibria' },
        { v: 'all', label: 'Все аниме' },
      ].map((t) => (
        <button
          key={t.v}
          onClick={() => setSp(t.v ? { src: t.v } : {}, { replace: true })}
          className={cn('rounded-full px-5 py-2 text-sm font-bold transition', (t.v === 'all') === all ? 'bg-white text-black' : 'text-white/70 hover:text-white')}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export default function Catalog() {
  const [sp] = useSearchParams()
  if (sp.get('src') === 'all')
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Каталог</h1>
          <div className="mt-1 text-sm font-semibold text-muted">Все аниме с Shikimori. С пометкой AniLibria открываются в нашем плеере, остальные через Kodik</div>
        </div>
        <SourceTabs />
        <ShikiCatalog Select={Select} />
      </div>
    )
  return <LibriaCatalog />
}

function LibriaCatalog() {
  const [sp, setSp] = useSearchParams()
  const genres = useAsync(() => api.genres(), [])
  const years = useAsync(() => api.years(), [])
  const [showGenres, setShowGenres] = useState(!!sp.get('genre'))

  const filters: CatalogParams = {
    sorting: sp.get('sort') || 'FRESH_AT_DESC',
    genres: sp.get('genre') ? sp.get('genre')!.split(',').map(Number) : [],
    type: sp.get('type') || undefined,
    season: sp.get('season') || undefined,
    yearFrom: sp.get('year') ? Number(sp.get('year')) : undefined,
    yearTo: sp.get('year') ? Number(sp.get('year')) : undefined,
    status: sp.get('status') || undefined,
  }
  const key = sp.toString()

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v)
    else n.delete(k)
    setSp(n, { replace: true })
  }
  const toggleGenre = (id: number) => {
    const cur = new Set(filters.genres)
    if (cur.has(id)) cur.delete(id)
    else cur.add(id)
    set('genre', [...cur].join(','))
  }

  const [items, setItems] = useState<Release[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState<number | null>(null)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setItems([])
    setPage(1)
    setTotal(null)
  }, [key])

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .catalog({ ...filters, page, limit: 30 })
      .then((res) => {
        if (!alive) return
        setItems((prev) => (page === 1 ? res.data : [...prev, ...res.data.filter((r) => !prev.some((p) => p.id === r.id))]))
        setTotal(res.meta.pagination.total)
        setPages(res.meta.pagination.total_pages)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting && !loading && page < pages) setPage((p) => p + 1)
    }, { rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  }, [loading, page, pages])

  const activeCount = [filters.type, filters.season, filters.yearFrom, filters.status].filter(Boolean).length + (filters.genres?.length ?? 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Каталог</h1>
          <div className="mt-1 text-sm font-semibold text-muted">{total != null ? `${total} тайтлов в озвучке AniLibria` : 'Загрузка…'}</div>
        </div>
        <SourceTabs />
        {activeCount > 0 && (
          <button onClick={() => setSp(new URLSearchParams(), { replace: true })} className="flex items-center gap-1 text-sm font-bold text-muted hover:text-white">
            <X size={16} /> Сбросить ({activeCount})
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={filters.sorting!} onChange={(v) => set('sort', v === 'FRESH_AT_DESC' ? '' : v)} options={SORTINGS} placeholder="Сортировка" />
        <Select value={filters.type ?? ''} onChange={(v) => set('type', v)} options={TYPES} placeholder="Любой тип" />
        <Select value={filters.season ?? ''} onChange={(v) => set('season', v)} options={SEASONS} placeholder="Любой сезон" />
        <Select
          value={sp.get('year') ?? ''}
          onChange={(v) => set('year', v)}
          options={[...(years.data ?? [])].reverse().map((y) => ({ value: String(y), label: String(y) }))}
          placeholder="Любой год"
        />
        <Select
          value={filters.status ?? ''}
          onChange={(v) => set('status', v)}
          options={[
            { value: 'IS_ONGOING', label: 'Онгоинги' },
            { value: 'IS_NOT_ONGOING', label: 'Завершённые' },
          ]}
          placeholder="Любой статус"
        />
        <button
          onClick={() => setShowGenres(!showGenres)}
          className={cn('flex h-11 items-center gap-2 rounded-full px-4 text-sm font-bold ring-1 ring-white/5', showGenres || filters.genres?.length ? 'bg-white text-black' : 'bg-card-2 hover:bg-white/10')}
        >
          <SlidersHorizontal size={16} /> Жанры{filters.genres?.length ? ` · ${filters.genres.length}` : ''}
        </button>
      </div>

      {showGenres && (
        <div className="animate-fade-in flex flex-wrap gap-2">
          {genres.data?.map((g) => (
            <Chip key={g.id} active={filters.genres?.includes(g.id)} onClick={() => toggleGenre(g.id)}>
              {g.name}
            </Chip>
          ))}
        </div>
      )}

      {items.length === 0 && !loading && total === 0 ? (
        <Empty icon={<SearchX />} title="Ничего не найдено" text="Попробуйте убрать часть фильтров." />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {items.map((r) => (
            <ReleaseCard key={r.id} r={r} />
          ))}
          {loading && <CardSkeletons n={items.length ? 6 : 18} />}
        </div>
      )}
      <div ref={sentinel} className="flex h-10 items-center justify-center">
        {loading && items.length > 0 && <Loader2 className="animate-spin text-muted" />}
      </div>
    </div>
  )
}
