import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { shiki, SHIKI_ORDERS, KINDS, type ShikiAnime } from '../lib/shikimori'
import { ShikiCard, CardSkeletons } from '../components/ui'

const YEARS = Array.from({ length: new Date().getFullYear() - 1979 }, (_, i) => String(new Date().getFullYear() - i))

type SelectProps = { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string }

/** every anime on Shikimori; titles voiced by AniLibria are marked and open in our player */
export default function ShikiCatalog({ Select }: { Select: (p: SelectProps) => ReactNode }) {
  const [sp, setSp] = useSearchParams()
  const order = sp.get('order') || 'popularity'
  const kind = sp.get('kind') || ''
  const status = sp.get('status') || ''
  const year = sp.get('year') || ''
  const key = `${order}|${kind}|${status}|${year}`
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v)
    else n.delete(k)
    setSp(n, { replace: true })
  }

  const [items, setItems] = useState<ShikiAnime[]>([])
  const [page, setPage] = useState(1)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setItems([])
    setPage(1)
    setDone(false)
  }, [key])

  useEffect(() => {
    let alive = true
    setLoading(true)
    shiki
      .list({ page, limit: 30, order, kind: kind || undefined, status: status || undefined, season: year || undefined })
      .then((res) => {
        if (!alive) return
        setItems((prev) => (page === 1 ? res : [...prev, ...res.filter((r) => !prev.some((p) => p.id === r.id))]))
        if (res.length < 30) setDone(true)
      })
      .catch(() => setDone(true))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [key, page, order, kind, status, year])

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((es) => es[0].isIntersecting && !loading && !done && setPage((p) => p + 1), { rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  }, [loading, done])

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Select value={order} onChange={(v) => set('order', v === 'popularity' ? '' : v)} options={SHIKI_ORDERS} placeholder="Сортировка" />
        <Select
          value={kind}
          onChange={(v) => set('kind', v)}
          options={['tv', 'movie', 'ova', 'ona', 'special'].map((k) => ({ value: k, label: KINDS[k] }))}
          placeholder="Любой тип"
        />
        <Select
          value={status}
          onChange={(v) => set('status', v)}
          options={[
            { value: 'ongoing', label: 'Онгоинги' },
            { value: 'released', label: 'Вышедшие' },
            { value: 'anons', label: 'Анонсы' },
          ]}
          placeholder="Любой статус"
        />
        <Select value={year} onChange={(v) => set('year', v)} options={YEARS.map((y) => ({ value: y, label: y }))} placeholder="Любой год" />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {items.map((a) => (
          <ShikiCard key={a.id} a={a} />
        ))}
        {loading && <CardSkeletons n={items.length ? 6 : 18} />}
      </div>
      <div ref={sentinel} className="flex h-10 items-center justify-center">
        {loading && items.length > 0 && <Loader2 className="animate-spin text-muted" />}
      </div>
    </>
  )
}
