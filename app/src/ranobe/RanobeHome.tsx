import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, X, Loader2, FolderOpen, Languages, BookText } from 'lucide-react'
import { ReadTabs, Cover } from '../manga/ui'
import { Section, Row, Empty, Chip } from '../components/ui'
import { NewChapters, ReadingSchedule } from '../manga/ChapterUpdates'
import { SOURCES, sourceById } from './registry'
import type { NovelItem } from './sources'
import { chapterPath, novelPath, parseEntry, useReadingNovels } from './shelf'
import { cn } from '../lib/format'

export function NovelCard({ src, n }: { src: string; n: NovelItem }) {
  return (
    <Link to={novelPath(src, n.id)} className="group block">
      <Cover src={n.cover} className="aspect-[2/3] rounded-2xl ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-white/15" />
      <div className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-bold">{n.title}</div>
      {n.sub && <div className="mt-0.5 line-clamp-1 text-xs font-medium text-muted">{n.sub}</div>}
    </Link>
  )
}

/** the online ranobe catalog: search, popular and fresh titles from every source, and what is being read */
export default function RanobeHome() {
  const [sp, setSp] = useSearchParams()
  const src = sourceById(sp.get('src') ?? '') ?? SOURCES[0]
  const sort = sp.get('sort') ?? src.sorts[0].value
  const q = sp.get('q') ?? ''
  const [text, setText] = useState(q)
  const reading = useReadingNovels()

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k)
    setSp(next, { replace: true })
  }

  // typing waits a moment before searching
  useEffect(() => {
    const t = setTimeout(() => text.trim() !== q && set({ q: text.trim() }), 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Ранобэ</h1>
            <div className="mt-1 text-sm font-semibold text-muted">Тысячи ранобэ на русском, английские читаются в переводе Gemini</div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/ranobe/files"
              title="Свои книги: EPUB, FB2, TXT с устройства"
              className="flex h-10 items-center gap-2 rounded-full bg-card-2 px-4 text-sm font-bold text-white/70 ring-1 ring-white/5 hover:text-white"
            >
              <FolderOpen size={16} /> Файлы
            </Link>
            <ReadTabs />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex h-12 min-w-0 flex-1 basis-full items-center gap-3 rounded-full bg-card-2 px-5 sm:basis-auto ring-1 ring-white/5 focus-within:ring-accent/60">
            <Search size={18} className="shrink-0 text-muted" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={src.lang === 'ru' ? 'Название: Повелитель тайн, Реинкарнация безработного…' : 'Title: Toradora, Sword of the Emperor…'}
              className="min-w-0 flex-1 bg-transparent font-semibold outline-none placeholder:text-dim"
            />
            {text && (
              <button onClick={() => setText('')} className="text-muted hover:text-white">
                <X size={18} />
              </button>
            )}
          </label>
          <div className="flex h-12 gap-1 rounded-full bg-card-2 p-1 ring-1 ring-white/5">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                onClick={() => set({ src: s.id === SOURCES[0].id ? '' : s.id, sort: '' })}
                className={cn('flex items-center gap-1.5 rounded-full px-4 text-sm font-bold', s.id === src.id ? 'bg-white text-black' : 'text-white/70 hover:text-white')}
              >
                {s.lang === 'en' && <Languages size={14} />}
                {s.name}
                <span className="text-[10px] opacity-60">{s.lang.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {q ? (
        <Section title={<>Поиск: «{q}»</>}>
          <SearchResults key={src.id + q} src={src.id} q={q} />
        </Section>
      ) : (
        <>
          {reading.length > 0 && (
            <Section title="Продолжить чтение">
              <Row>
                {reading.slice(0, 20).map((e) => {
                  const { src: s, novelId } = parseEntry(e.id)
                  return (
                    <Link key={e.id} to={e.lastChapterId ? chapterPath(s, novelId, e.lastChapterId) : novelPath(s, novelId)} className="group block">
                      <Cover src={e.cover} className="aspect-[2/3] rounded-2xl ring-1 ring-white/5 transition group-hover:-translate-y-1 group-hover:ring-white/15">
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                        {e.lastLabel && <div className="absolute inset-x-2 bottom-2 line-clamp-2 text-[11px] font-extrabold">{e.lastLabel}</div>}
                      </Cover>
                      <div className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-bold">{e.title}</div>
                    </Link>
                  )
                })}
              </Row>
            </Section>
          )}
          <NewChapters kind="novel" />
          <ReadingSchedule kind="novel" />
          <Section
            title={src.sorts.find((s) => s.value === sort)?.label ?? 'Популярное'}
            action={
              <div className="no-scrollbar flex max-w-[55vw] gap-1 overflow-x-auto">
                {src.sorts.map((s) => (
                  <Chip key={s.value} active={s.value === sort} onClick={() => set({ sort: s.value === src.sorts[0].value ? '' : s.value })}>
                    {s.label}
                  </Chip>
                ))}
              </div>
            }
          >
            <Catalog key={src.id + sort} src={src.id} sort={sort} />
          </Section>
          <div className="text-center text-xs text-dim">{src.note}</div>
        </>
      )}
    </div>
  )
}

const GRID = 'grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'

function Catalog({ src, sort }: { src: string; sort: string }) {
  const source = sourceById(src)!
  const [items, setItems] = useState<NovelItem[]>([])
  const [page, setPage] = useState(1)
  const [more, setMore] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!more) return
    let alive = true
    setBusy(true)
    source
      .popular(page, sort)
      .then((r) => {
        if (!alive) return
        // the same title can show up on two pages when the list shifts in between
        setItems((cur) => [...cur, ...r.items.filter((n) => !cur.some((c) => c.id === n.id))])
        setMore(r.more && r.items.length > 0)
      })
      .catch((e) => alive && setError(String(e?.message ?? e)))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // the next page loads as the end of the grid comes into view
  useEffect(() => {
    const el = end.current
    if (!el) return
    const io = new IntersectionObserver(([hit]) => hit.isIntersecting && !busy && more && !error && setPage((p) => p + 1), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [busy, more, error])

  if (error && !items.length) return <Empty icon={<BookText />} title="Источник не ответил" text={error} />
  return (
    <>
      <div className={GRID}>
        {items.map((n) => (
          <NovelCard key={n.id} src={src} n={n} />
        ))}
      </div>
      <div ref={end} className="flex justify-center py-6">
        {busy && <Loader2 className="animate-spin text-muted" />}
      </div>
    </>
  )
}

function SearchResults({ src, q }: { src: string; q: string }) {
  const [items, setItems] = useState<NovelItem[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    sourceById(src)!
      .search(q)
      .then(setItems)
      .catch((e) => setError(String(e?.message ?? e)))
  }, [src, q])
  if (error) return <Empty icon={<BookText />} title="Источник не ответил" text={error} />
  if (!items) return <Loader2 className="mx-auto animate-spin text-muted" />
  if (!items.length) return <Empty icon={<Search />} title="Ничего не нашлось" text="Попробуйте другое название или другой источник." />
  return (
    <div className={GRID}>
      {items.map((n) => (
        <NovelCard key={n.id} src={src} n={n} />
      ))}
    </div>
  )
}
