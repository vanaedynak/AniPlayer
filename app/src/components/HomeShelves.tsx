// More rows under the home page's own: popular, ongoing, this year, films, classics and a run of genres.
// They come in a few at a time as the page scrolls down, each fetched only when it shows up.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Loader2 } from 'lucide-react'
import { api, type CatalogParams } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { Section, Row, ReleaseCard, CardSkeletons } from './ui'

interface Shelf {
  title: string
  params: CatalogParams
  /** the same list in the catalog */
  href: string
}

const YEAR = new Date().getFullYear()

const FIXED: Shelf[] = [
  { title: 'Самое популярное', params: { sorting: 'RATING_DESC' }, href: '/catalog?sort=RATING_DESC' },
  { title: 'Онгоинги: выходят сейчас', params: { sorting: 'RATING_DESC', status: 'IS_ONGOING' }, href: '/catalog?sort=RATING_DESC&status=IS_ONGOING' },
  { title: `Лучшее ${YEAR} года`, params: { sorting: 'RATING_DESC', yearFrom: YEAR, yearTo: YEAR }, href: `/catalog?sort=RATING_DESC&year=${YEAR}` },
  { title: 'Полнометражные фильмы', params: { sorting: 'RATING_DESC', type: 'MOVIE' }, href: '/catalog?sort=RATING_DESC&type=MOVIE' },
  { title: 'Классика: до 2012 года', params: { sorting: 'RATING_DESC', yearTo: 2012 }, href: '/catalog?sort=RATING_DESC' },
  { title: 'OVA и спешлы', params: { sorting: 'RATING_DESC', type: 'OVA' }, href: '/catalog?sort=RATING_DESC&type=OVA' },
]

// AniLibria genre ids
const GENRES: [number, string][] = [
  [34, 'Исекай: попал в другой мир'],
  [11, 'Романтика'],
  [1, 'Комедия'],
  [14, 'Экшен'],
  [10, 'Повседневность'],
  [12, 'Спорт'],
  [13, 'Ужасы'],
  [25, 'Детективы'],
  [3, 'Психологическое'],
  [29, 'Фэнтези'],
  [2, 'Меха'],
  [7, 'Школа'],
  [28, 'Сверхъестественное'],
  [27, 'Приключения'],
  [22, 'Фантастика'],
  [18, 'Магия'],
  [30, 'Киберпанк'],
  [19, 'Музыка'],
  [26, 'Исторические'],
  [15, 'Боевые искусства'],
  [6, 'Триллеры'],
  [9, 'Мистика'],
]

/** the genres in a different order every day, so the page does not look the same each visit */
function genreShelves(): Shelf[] {
  let seed = Math.floor(Date.now() / 86_400_000)
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  return [...GENRES]
    .map((g) => [rnd(), g] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, [id, title]]) => ({ title, params: { sorting: 'RATING_DESC', genres: [id] }, href: `/catalog?sort=RATING_DESC&genre=${id}` }))
}

const STEP = 3

export function HomeShelves() {
  const shelves = useMemo(() => [...FIXED, ...genreShelves()], [])
  const [shown, setShown] = useState(STEP)
  const end = useRef<HTMLDivElement>(null)
  const more = shown < shelves.length

  useEffect(() => {
    const el = end.current
    if (!el || !more) return
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setShown((n) => n + STEP), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more, shown])

  return (
    <>
      {shelves.slice(0, shown).map((s) => (
        <ShelfRow key={s.title} shelf={s} />
      ))}
      {more && (
        <div ref={end} className="flex justify-center">
          <button
            onClick={() => setShown((n) => n + STEP)}
            className="flex items-center gap-2 rounded-full bg-card-2 px-5 py-2.5 text-sm font-bold text-muted ring-1 ring-white/5 hover:text-white"
          >
            <Loader2 size={15} className="animate-spin" /> Ещё подборки
          </button>
        </div>
      )}
    </>
  )
}

function ShelfRow({ shelf }: { shelf: Shelf }) {
  const { data, error } = useAsync(() => api.catalog({ ...shelf.params, limit: 20 }), [shelf])
  if (error || (data && !data.data.length)) return null
  return (
    <Section
      title={shelf.title}
      action={
        <Link to={shelf.href} className="flex items-center text-sm font-bold text-muted hover:text-white">
          Все <ChevronRight size={16} />
        </Link>
      }
    >
      <Row>{data ? data.data.map((r) => <ReleaseCard key={r.id} r={r} />) : Array.from({ length: 6 }, (_, i) => <CardSkeletons key={i} n={1} />)}</Row>
    </Section>
  )
}
