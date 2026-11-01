import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search as SearchIcon, X, SearchX } from 'lucide-react'
import { api, type Release } from '../lib/api'
import { shiki, type ShikiAnime } from '../lib/shikimori'
import { ReleaseCard, ShikiCard, CardSkeletons, Empty } from '../components/ui'
import { shikiTitle } from '../lib/shikimori'
import { useFolded } from '../lib/franchise'
import { useStore } from '../lib/store'

export default function Search() {
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [items, setItems] = useState<Release[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [others, setOthers] = useState<ShikiAnime[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const titles = useStore((s) => s.titles)
  // every season of one anime is one card
  const libria = useFolded(items ?? [], (r) => r.mal?.id, (r) => `r${r.id}`, (r) => r.name.main, (r) => titles[r.id]?.lastWatchedAt ?? 0)
  const rest = useFolded(others, (a) => a.id, (a) => `s${a.id}`, shikiTitle)

  useEffect(() => {
    if (!q) inputRef.current?.focus()
  }, [q])

  useEffect(() => {
    const query = q.trim()
    setSp(query ? { q: query } : {}, { replace: true })
    if (query.length < 2) {
      setItems(null)
      setOthers([])
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
      shiki
        .search(query, 30)
        .then(setOthers)
        .catch(() => setOthers([]))
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
      {items !== null && items.length > 0 && <h2 className="text-xl font-extrabold">В озвучке AniLibria</h2>}
      {items === null && !loading ? (
        <Empty icon={<SearchIcon />} title="Что посмотрим?" text="Начните вводить название — результаты появятся сразу." />
      ) : items?.length === 0 && !loading && others.length === 0 ? (
        <Empty icon={<SearchX />} title="Ничего не нашлось" text="Попробуйте другое написание или английское название." />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {loading ? <CardSkeletons n={12} /> : libria.map((g) => <ReleaseCard key={g.key} r={g.lead} title={g.name} parts={g.parts.length} />)}
        </div>
      )}
      {(() => {
        // an anime AniLibria has already shows above, with all its seasons
        const mine = new Set(libria.flatMap((g) => [g.franchise, ...g.parts.map((r) => r.mal?.id)]))
        const shown = rest.filter((g) => !mine.has(g.franchise) && !g.parts.some((a) => mine.has(a.id)))
        return shown.length ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-extrabold">
              Другие аниме <span className="text-sm font-semibold text-muted">· все озвучки, Studio Band и другие</span>
            </h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {shown.map((g) => (
                <ShikiCard key={g.key} a={g.lead} title={g.name} parts={g.parts.length} />
              ))}
            </div>
          </section>
        ) : null
      })()}
    </div>
  )
}
