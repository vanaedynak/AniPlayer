import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, X, SearchX, Languages } from 'lucide-react'
import { list, search, GENRES, LANGS, type Manga } from './md'
import { useManga } from './store'
import { MangaCard, EntryCard, ReadTabs } from './ui'
import { CardSkeletons, Chip, Empty, Row, Section } from '../components/ui'
import { cn } from '../lib/format'

const GRID = 'grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'

/** grid that loads more pages on demand */
function Feed({ load, deps }: { load: (offset: number) => Promise<{ items: Manga[]; total: number }>; deps: unknown[] }) {
  const [items, setItems] = useState<Manga[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setItems([])
    setBusy(true)
    setError('')
    load(0)
      .then((r) => alive && (setItems(r.items), setTotal(r.total)))
      .catch((e) => alive && setError(String(e?.message ?? e)))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const more = () => {
    setBusy(true)
    load(items.length)
      .then((r) => setItems((cur) => [...cur, ...r.items.filter((m) => !cur.some((c) => c.id === m.id))]))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setBusy(false))
  }

  if (error && !items.length) return <Empty icon={<SearchX />} title="Не удалось загрузить" text={error} />
  if (!busy && !items.length) return <Empty icon={<SearchX />} title="Ничего не нашлось" text="Попробуйте английское или японское название — MangaDex знает их лучше всего." />
  return (
    <>
      <div className={GRID}>
        {items.map((m) => (
          <MangaCard key={m.id} m={m} />
        ))}
        {busy && <CardSkeletons n={items.length ? 6 : 12} />}
      </div>
      {!busy && items.length < total && (
        <button onClick={more} className="mx-auto mt-2 flex h-12 items-center gap-2 rounded-full bg-white/10 px-8 font-bold hover:bg-white/15">
          Показать ещё
        </button>
      )}
    </>
  )
}

export default function MangaHome() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''
  const genre = sp.get('genre') ?? ''
  const order = (sp.get('order') ?? 'followedCount') as 'followedCount' | 'latestUploadedChapter' | 'rating'
  const [text, setText] = useState(q)
  const lang = useManga((s) => s.prefs.lang)
  const adult = useManga((s) => s.prefs.adult)
  const setPrefs = useManga((s) => s.setPrefs)
  const entries = useManga((s) => s.entries)

  // typing waits a moment before searching
  useEffect(() => {
    const t = setTimeout(() => {
      if (text.trim() === q) return
      const next = new URLSearchParams(sp)
      if (text.trim()) next.set('q', text.trim())
      else next.delete('q')
      setSp(next, { replace: true })
    }, 450)
    return () => clearTimeout(t)
  }, [text, q, sp, setSp])

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp)
    if (v) next.set(k, v)
    else next.delete(k)
    setSp(next, { replace: true })
  }

  const reading = useMemo(() => Object.values(entries).filter((e) => e.lastChapterId).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0)), [entries])
  const shelf = useMemo(() => Object.values(entries).filter((e) => (e.status && e.status !== 'reading') || e.favorite).sort((a, b) => b.updatedAt - a.updatedAt), [entries])

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Манга</h1>
            <div className="mt-1 text-sm font-semibold text-muted">Манга, манхва и маньхуа с MangaDex — десятки тысяч тайтлов на русском, английском и других языках</div>
          </div>
          <ReadTabs />
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full bg-card-2 px-5 ring-1 ring-white/5 focus-within:ring-accent/60">
            <Search size={18} className="shrink-0 text-muted" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Название манги: Берсерк, Solo Leveling, ワンピース…"
              className="min-w-0 flex-1 bg-transparent font-semibold outline-none placeholder:text-dim"
            />
            {text && (
              <button onClick={() => setText('')} className="text-muted hover:text-white">
                <X size={18} />
              </button>
            )}
          </label>
          <label className="flex h-12 items-center gap-2 rounded-full bg-card-2 pr-2 pl-4 text-sm font-bold ring-1 ring-white/5" title="Язык перевода">
            <Languages size={16} className="text-muted" />
            <select value={lang} onChange={(e) => setPrefs({ lang: e.target.value })} className="bg-transparent pr-2 outline-none">
              <option value="ru">Русский</option>
              <option value="en">English</option>
              <option value="uk">Українська</option>
              <option value="any">Любой язык</option>
            </select>
          </label>
        </div>
      </div>

      {q ? (
        <Section title={<>Поиск: «{q}»</>}>
          <Feed load={(offset) => search(q, offset)} deps={[q, adult]} />
        </Section>
      ) : (
        <>
          {reading.length > 0 && (
            <Section title="Продолжить чтение">
              <Row>
                {reading.slice(0, 20).map((e) => (
                  <EntryCard key={e.id} e={e} />
                ))}
              </Row>
            </Section>
          )}
          {shelf.length > 0 && (
            <Section title="Моя полка">
              <Row>
                {shelf.slice(0, 30).map((e) => (
                  <EntryCard key={e.id} e={e} />
                ))}
              </Row>
            </Section>
          )}
          <Section
            title={genre ? GENRES[genre] : order === 'latestUploadedChapter' ? 'Свежие главы' : order === 'rating' ? 'Лучшие по оценкам' : 'Популярное'}
            action={
              <div className="hidden gap-1 rounded-full bg-card-2 p-1 ring-1 ring-white/5 sm:flex">
                {[
                  { v: 'followedCount', l: 'Популярное' },
                  { v: 'latestUploadedChapter', l: 'Свежие главы' },
                  { v: 'rating', l: 'По оценкам' },
                ].map((o) => (
                  <button
                    key={o.v}
                    onClick={() => set('order', o.v === 'followedCount' ? '' : o.v)}
                    className={cn('rounded-full px-4 py-1.5 text-sm font-bold', order === o.v ? 'bg-white text-black' : 'text-white/70 hover:text-white')}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            }
          >
            <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
              <Chip active={!genre} onClick={() => set('genre', '')}>
                Все
              </Chip>
              {Object.entries(GENRES).map(([k, v]) => (
                <Chip key={k} active={genre === k} onClick={() => set('genre', genre === k ? '' : k)}>
                  {v}
                </Chip>
              ))}
            </div>
            <div className="mb-4 flex gap-1 sm:hidden">
              {[
                { v: 'followedCount', l: 'Популярное' },
                { v: 'latestUploadedChapter', l: 'Свежие' },
                { v: 'rating', l: 'Оценки' },
              ].map((o) => (
                <Chip key={o.v} active={order === o.v} onClick={() => set('order', o.v === 'followedCount' ? '' : o.v)}>
                  {o.l}
                </Chip>
              ))}
            </div>
            <Feed load={(offset) => list({ order, genre, lang, offset })} deps={[order, genre, lang, adult]} />
          </Section>
          <div className="text-center text-xs text-dim">
            Каталог и главы — <span className="font-bold">MangaDex</span>, переводы делают команды-переводчики, их названия указаны у каждой главы.
            {lang !== 'any' && ` Показаны тайтлы, у которых есть перевод на ${({ ru: 'русский', en: 'английский', uk: 'украинский' } as Record<string, string>)[lang] ?? LANGS[lang] ?? lang}.`}
          </div>
        </>
      )}
    </div>
  )
}
