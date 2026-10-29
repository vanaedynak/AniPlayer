import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search as SearchIcon, X, SearchX } from 'lucide-react'
import { api, type Release } from '../lib/api'
import { ReleaseCard, CardSkeletons, Empty } from '../components/ui'

export default function Search() {
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [items, setItems] = useState<Release[] | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!q) inputRef.current?.focus()
  }, [q])

  useEffect(() => {
    const query = q.trim()
    setSp(query ? { q: query } : {}, { replace: true })
    if (query.length < 2) {
      setItems(null)
      return
    }
    setLoading(true)
    const t = setTimeout(() => {
      // search endpoint matches titles in any language; catalog search adds more for latin queries
      Promise.all([api.search(query), api.catalog({ search: query, limit: 30, sorting: 'RATING_DESC' }).then((r) => r.data).catch(() => [])])
        .then(([a, b]) => {
          const seen = new Set<number>()
          setItems([...a, ...b].filter((r) => !seen.has(r.id) && seen.add(r.id)))
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex h-14 items-center gap-3 rounded-full bg-white/[0.07] px-6 ring-1 ring-white/5 focus-within:ring-accent/50">
        <SearchIcon size={20} className="text-muted" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Название аниме на русском, английском или японском"
          className="h-full flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-muted"
        />
        {q && (
          <button onClick={() => setQ('')} className="text-muted hover:text-white">
            <X />
          </button>
        )}
      </div>
      {items === null && !loading ? (
        <Empty icon={<SearchIcon />} title="Что посмотрим?" text="Начните вводить название — результаты появятся сразу." />
      ) : items?.length === 0 && !loading ? (
        <Empty icon={<SearchX />} title="Ничего не нашлось" text="Попробуйте другое написание или английское название." />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {loading ? <CardSkeletons n={12} /> : items!.map((r) => <ReleaseCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}
