// Baka-Tsuki: fan translations of light novels into English, on MediaWiki with an open API that allows CORS.
// Chapters are in English; the reader translates them into Russian with Gemini in one tap.
import type { ChapterRef, Novel, NovelItem, Source } from './sources'

const API = 'https://www.baka-tsuki.org/project/api.php'
const CATEGORY = 'Category:Light_novel_(English)'

async function api<T>(params: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`)
  if (!res.ok) throw new Error(`Baka-Tsuki HTTP ${res.status}`)
  return res.json()
}

type Pages = { query?: { pages?: Record<string, { title: string; thumbnail?: { source: string } }> }; continue?: Record<string, string> }

const toItems = (r: Pages): NovelItem[] =>
  Object.values(r.query?.pages ?? {})
    .map((p) => ({ id: p.title, title: p.title, cover: p.thumbnail?.source ?? '', sub: 'English' }))
    .sort((a, b) => a.title.localeCompare(b.title))

// MediaWiki pages its lists by a continuation token, not by number: remember them as we go
const cont: Record<string, (Record<string, string> | null)[]> = {}

export const bakatsuki: Source = {
  id: 'bt',
  name: 'Baka-Tsuki',
  lang: 'en',
  note: 'Английские фан-переводы ранобэ с Baka-Tsuki. Нажмите «Перевести» в читалке — глава будет на русском.',
  sorts: [
    { value: 'updated', label: 'Обновлённые' },
    { value: 'az', label: 'По алфавиту' },
  ],

  async popular(page, sort) {
    const tokens = (cont[sort] ??= [{}])
    const from = tokens[page - 1]
    if (!from) return { items: [], more: false }
    // the list keeps its order (newest edits first, or A–Z); covers come in a second request
    const r = await api<{ query: { categorymembers: { title: string }[] }; continue?: Record<string, string> }>({
      action: 'query',
      list: 'categorymembers',
      cmtitle: CATEGORY,
      cmnamespace: '0',
      cmlimit: '30',
      ...(sort === 'updated' ? { cmsort: 'timestamp', cmdir: 'desc' } : {}),
      ...from,
    })
    tokens[page] = r.continue ?? null
    const titles = r.query.categorymembers.map((m) => m.title)
    const covers = await api<Pages>({ action: 'query', titles: titles.join('|'), prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '300' })
    const byTitle = new Map(toItems(covers).map((i) => [i.title, i]))
    return { items: titles.map((t) => byTitle.get(t) ?? { id: t, title: t, cover: '', sub: 'English' }), more: !!r.continue }
  },

  async search(q) {
    // the wiki's search knows no category filter: English series pages are the hits with a genre or the
    // English category, and none of the other languages' (Toradora! sits in genres only)
    const r = await api<{ query?: { pages?: Record<string, { title: string; index: number; thumbnail?: { source: string }; categories?: { title: string }[] }> } }>({
      action: 'query',
      generator: 'search',
      gsrsearch: q,
      gsrnamespace: '0',
      gsrlimit: '50',
      prop: 'pageimages|categories',
      cllimit: 'max',
      piprop: 'thumbnail',
      pithumbsize: '300',
    })
    return Object.values(r.query?.pages ?? {})
      .filter((p) => {
        const cats = (p.categories ?? []).map((c) => c.title)
        return !p.title.includes(':') && cats.some((c) => /Light novel \(English\)|Genre - /.test(c)) && !cats.some((c) => /Light novel \((?!English)/.test(c))
      })
      .sort((a, b) => a.index - b.index)
      .map((p) => ({ id: p.title, title: p.title, cover: p.thumbnail?.source ?? '', sub: 'English' }))
  },

  async novel(id) {
    const r = await api<{ parse: { title: string; text: { '*': string } } }>({ action: 'parse', page: id, prop: 'text', redirects: '1' })
    const doc = new DOMParser().parseFromString(r.parse.text['*'], 'text/html')
    const title = r.parse.title
    const img = doc.querySelector<HTMLImageElement>('img')
    // the series page links its chapters as "<Series>:Volume N Chapter M", in reading order
    const seen = new Set<string>()
    const chapters: ChapterRef[] = []
    for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[title]')) {
      const t = a.getAttribute('title') ?? ''
      if (!t.startsWith(title + ':') || seen.has(t) || /registration|updates|format guideline|translator/i.test(t)) continue
      const rest = t.slice(title.length + 1)
      seen.add(t)
      const vol = /volume\s*(\S+)/i.exec(rest)?.[1]
      chapters.push({ id: t, title: rest.replace(/_/g, ' '), volume: vol ? `Volume ${vol}` : undefined })
    }
    // a whole-volume page repeats its chapters when they have pages of their own; alone, it is the volume
    const parts = chapters.filter((c) => !chapters.some((o) => o !== c && o.title.startsWith(c.title + ' ')))
    const summary = [...doc.querySelectorAll('p')]
      .map((p) => p.textContent?.trim() ?? '')
      .find((t) => t.length > 120)
    const novel: Novel = {
      id,
      title,
      cover: img ? new URL(img.getAttribute('src') ?? '', 'https://www.baka-tsuki.org').href : '',
      sub: 'English',
      summary: summary ?? '',
      genres: [],
      chapters: parts,
    }
    return novel
  },

  async chapter(_novelId, chapterId) {
    const r = await api<{ parse: { text: { '*': string } } }>({ action: 'parse', page: chapterId, prop: 'text', redirects: '1', disableeditsection: '1' })
    const doc = new DOMParser().parseFromString(r.parse.text['*'], 'text/html')
    // navigation tables, the table of contents and wiki notices are not part of the story
    doc.querySelectorAll('table, #toc, .toc, .mw-editsection, .noprint, script, style').forEach((el) => el.remove())
    doc.querySelectorAll('img').forEach((img) => img.setAttribute('src', new URL(img.getAttribute('src') ?? '', 'https://www.baka-tsuki.org').href))
    doc.querySelectorAll('a').forEach((a) => a.replaceWith(...a.childNodes))
    return doc.body.innerHTML
  },
}
