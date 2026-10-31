// RanobeHub: the largest Russian ranobe catalog with an open JSON API (catalog, search, chapters, text).
import { getJson, getText, stripTags, type Novel, type NovelItem, type Source } from './sources'

const SITE = 'https://ranobehub.org'
const DEV = { from: SITE, to: '/ranobehub' }

interface Book {
  id: number | string
  slug: string
  title: string
  originalTitle?: string
  description?: string
  posterUrl?: string
  status?: string
  year?: number | string
  chapters?: number | string
  tags?: string[]
}

const abs = (u?: string) => (!u ? '' : u.startsWith('http') ? u : SITE + u)
const item = (b: Book): NovelItem => ({
  id: `${b.id}-${b.slug}`,
  title: b.title || b.originalTitle || '',
  cover: abs(b.posterUrl),
  sub: [b.status, b.chapters ? `${b.chapters} гл.` : null, b.year].filter(Boolean).join(' · '),
})

// details come with the catalog and search lists; opening a book by link alone reads its page
const known = new Map<string, Book>()

export const ranobehub: Source = {
  id: 'rh',
  name: 'RanobeHub',
  lang: 'ru',
  note: 'Каталог и переводы — RanobeHub, переводят команды-переводчики.',
  sorts: [
    { value: 'popular', label: 'Популярное' },
    { value: 'updated', label: 'Обновления' },
    { value: 'rating', label: 'Лучшее' },
    { value: 'new', label: 'Новинки' },
  ],

  async popular(page, sort) {
    const p = new URLSearchParams({ page: String(page) })
    if (sort !== 'updated') p.set('sort', sort)
    const r = await getJson<{ items: Book[]; pages: number }>(`${SITE}/api/catalog?${p}`, DEV)
    r.items.forEach((b) => known.set(`${b.id}-${b.slug}`, b))
    return { items: r.items.map(item), more: page < r.pages }
  },

  async search(q) {
    const r = await getJson<{ books: Book[] }>(`${SITE}/api/search?q=${encodeURIComponent(q)}`, DEV)
    r.books.forEach((b) => known.set(`${b.id}-${b.slug}`, b))
    return r.books.map(item)
  },

  async novel(id) {
    const bookId = id.split('-', 1)[0]
    let b = known.get(id)
    const [page, chapters] = await Promise.all([b ? null : getText(`${SITE}/ranobe/${id}`, DEV).catch(() => ''), allChapters(bookId)])
    if (!b) {
      const title = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(page ?? '')?.[1]
      const desc = /<div[^>]+id="book-description"[^>]*>([\s\S]*?)<\/div>/.exec(page ?? '')?.[1]
      const cover = /<img[^>]+src="\/_next\/image\?url=([^"&]+)/.exec(page ?? '')?.[1]
      b = { id: bookId, slug: id.slice(bookId.length + 1), title: stripTags(title ?? ''), description: stripTags(desc ?? ''), posterUrl: cover ? decodeURIComponent(cover) : '' }
    }
    const novel: Novel = {
      ...item(b),
      original: b.originalTitle,
      summary: b.description ?? '',
      status: b.status,
      genres: Array.isArray(b.tags) ? b.tags : [],
      chapters,
    }
    return novel
  },

  async chapter(_novelId, chapterId) {
    const r = await getJson<{ chapter: { html: string } }>(`${SITE}/api/chapters/${chapterId}`, DEV)
    return r.chapter.html.replace(/src="\/(api\/media\/[^"]*)"/g, `src="${SITE}/$1"`)
  },
}

async function allChapters(bookId: string) {
  type Page = { total: number; items: { id: number; volume: number; title: string }[] }
  const url = (offset: number) => `${SITE}/api/books/${bookId}/chapters?limit=250&offset=${offset}`
  const first = await getJson<Page>(url(0), DEV)
  const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(first.total / 250) - 1) }, (_, i) => getJson<Page>(url((i + 1) * 250), DEV)))
  return [first, ...rest].flatMap((p) => p.items).map((c) => ({ id: String(c.id), title: c.title, volume: c.volume ? `Том ${c.volume}` : undefined }))
}
