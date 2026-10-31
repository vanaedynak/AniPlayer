// Ranobe as files: EPUB, FB2 (also .fb2.zip) and TXT, kept in the app's own storage.
// No open ranobe API exists, so the reader opens the books people already have.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { unzipSync, strFromU8 } from 'fflate'
import { storage, keepStorage } from '../lib/offline'

export interface Book {
  id: string
  title: string
  author: string
  format: 'epub' | 'fb2' | 'txt'
  file: string
  size: number
  cover: string
  chapters: number
  addedAt: number
  chapter: number
  /** scroll position inside the chapter, 0..1 */
  frac: number
  readAt: number
}

export interface BookChapter {
  title: string
  html: string
}

export interface Parsed {
  title: string
  author: string
  cover: string
  chapters: BookChapter[]
}

interface BooksState {
  books: Record<string, Book>
  add: (b: Book) => void
  remove: (id: string) => void
  position: (id: string, chapter: number, frac: number) => void
}

export const useBooks = create<BooksState>()(
  persist(
    (set, get) => ({
      books: {},
      add: (b) => set({ books: { ...get().books, [b.id]: b } }),
      remove: (id) => {
        const { [id]: gone, ...rest } = get().books
        set({ books: rest })
        if (gone) void storage.removeDir(`book-${id}`)
        parsedCache.delete(id)
      },
      position: (id, chapter, frac) => {
        const b = get().books[id]
        if (b) set({ books: { ...get().books, [id]: { ...b, chapter, frac, readAt: Date.now() } } })
      },
    }),
    { name: 'aniplayer-books', version: 1 },
  ),
)

// --- parsing ------------------------------------------------------------------------------------

const xml = (text: string, type: DOMParserSupportedType = 'application/xml') => new DOMParser().parseFromString(text, type)
const byTag = (d: Document | Element, tag: string) => [...d.getElementsByTagNameNS('*', tag)]
const first = (d: Document | Element, tag: string) => byTag(d, tag)[0]

function decode(bytes: Uint8Array) {
  // FB2 and TXT from Russian sites are often windows-1251
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 200))
  const enc = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]
  if (enc) return new TextDecoder(enc).decode(bytes)
  const utf = new TextDecoder('utf-8', { fatal: true })
  try {
    return utf.decode(bytes)
  } catch {
    return new TextDecoder('windows-1251').decode(bytes)
  }
}

const mime = (name: string) =>
  ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' })[
    name.split('.').pop()!.toLowerCase()
  ] ?? 'application/octet-stream'

/** resolves "../images/a.jpg" against "OEBPS/text/ch1.xhtml" */
function resolve(base: string, rel: string) {
  const parts = base.split('/').slice(0, -1)
  for (const p of decodeURIComponent(rel.split('#')[0]).split('/')) {
    if (p === '..') parts.pop()
    else if (p && p !== '.') parts.push(p)
  }
  return parts.join('/')
}

// only plain text formatting survives; the book's own scripts, styles and links never run
const KEEP = new Set(['P', 'BR', 'EM', 'I', 'STRONG', 'B', 'U', 'S', 'SUB', 'SUP', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'HR', 'IMG', 'TABLE', 'TR', 'TD', 'TH', 'TBODY', 'SPAN', 'DIV', 'SECTION', 'RUBY', 'RT', 'CODE', 'PRE', 'FIGURE', 'FIGCAPTION'])

function clean(root: Element, image: (src: string) => string | null) {
  const out = document.createElement('div')
  const walk = (src: Node, dst: Element) => {
    for (const n of [...src.childNodes]) {
      if (n.nodeType === Node.TEXT_NODE) {
        dst.append(n.textContent ?? '')
        continue
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue
      const el = n as Element
      const tag = el.localName.toUpperCase()
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD' || tag === 'TITLE') continue
      if (tag === 'IMG' || tag === 'IMAGE') {
        const s = el.getAttribute('src') ?? el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
        const url = s ? image(s) : null
        if (url) {
          const img = document.createElement('img')
          img.src = url
          img.alt = ''
          dst.append(img)
        }
        continue
      }
      if (tag === 'SVG') {
        walk(el, dst)
        continue
      }
      if (KEEP.has(tag)) {
        const c = document.createElement(tag.toLowerCase())
        walk(el, c)
        dst.append(c)
      } else walk(el, dst)
    }
  }
  walk(root, out)
  return out.innerHTML
}

function parseEpub(bytes: Uint8Array): Parsed {
  const zip = unzipSync(bytes)
  const text = (p: string) => (zip[p] ? strFromU8(zip[p]) : '')
  const opfPath = first(xml(text('META-INF/container.xml')), 'rootfile')?.getAttribute('full-path') ?? ''
  const opf = xml(text(opfPath))
  const meta = (tag: string) => first(opf, tag)?.textContent?.trim() ?? ''
  const items = new Map(byTag(opf, 'item').map((i) => [i.getAttribute('id')!, i]))
  const href = (i: Element | undefined) => (i ? resolve(opfPath, i.getAttribute('href') ?? '') : '')

  const blobs = new Map<string, string>()
  const image = (path: string) => {
    if (!zip[path]) return null
    if (!blobs.has(path)) blobs.set(path, URL.createObjectURL(new Blob([zip[path] as BlobPart], { type: mime(path) })))
    return blobs.get(path)!
  }

  // chapter names from the table of contents (EPUB 3 nav or EPUB 2 NCX)
  const names = new Map<string, string>()
  const navItem = [...items.values()].find((i) => i.getAttribute('properties')?.includes('nav'))
  if (navItem) {
    const nav = xml(text(href(navItem)), 'application/xhtml+xml')
    for (const a of byTag(nav, 'a')) {
      const p = resolve(href(navItem), a.getAttribute('href') ?? '')
      if (!names.has(p)) names.set(p, a.textContent?.trim() ?? '')
    }
  } else {
    const ncx = [...items.values()].find((i) => i.getAttribute('media-type') === 'application/x-dtbncx+xml')
    if (ncx) {
      for (const np of byTag(xml(text(href(ncx))), 'navPoint')) {
        const p = resolve(href(ncx), first(np, 'content')?.getAttribute('src') ?? '')
        if (!names.has(p)) names.set(p, first(np, 'text')?.textContent?.trim() ?? '')
      }
    }
  }

  const chapters: BookChapter[] = []
  for (const ref of byTag(opf, 'itemref')) {
    const path = href(items.get(ref.getAttribute('idref') ?? ''))
    const src = text(path)
    if (!src) continue
    const d = xml(src, 'application/xhtml+xml')
    const body = first(d, 'body') ?? xml(src, 'text/html').body
    if (!body) continue
    const html = clean(body, (s) => image(resolve(path, s)))
    if (!html.replace(/<[^>]+>/g, '').trim() && !html.includes('<img')) continue
    const heading = (first(body, 'h1') ?? first(body, 'h2') ?? first(body, 'h3'))?.textContent?.trim()
    chapters.push({ title: names.get(path) || heading || `Глава ${chapters.length + 1}`, html })
  }

  const coverId =
    [...items.values()].find((i) => i.getAttribute('properties')?.includes('cover-image'))?.getAttribute('id') ??
    byTag(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content')
  return { title: meta('title'), author: meta('creator'), cover: image(href(items.get(coverId ?? ''))) ?? '', chapters }
}

function parseFb2(bytes: Uint8Array): Parsed {
  const d = xml(decode(bytes))
  const bins = new Map(byTag(d, 'binary').map((b) => [b.getAttribute('id') ?? '', b]))
  const blobs = new Map<string, string>()
  const image = (ref: string) => {
    const id = ref.replace(/^#/, '')
    const b = bins.get(id)
    if (!b) return null
    if (!blobs.has(id)) {
      const raw = atob((b.textContent ?? '').replace(/\s+/g, ''))
      const u8 = Uint8Array.from(raw, (c) => c.charCodeAt(0))
      blobs.set(id, URL.createObjectURL(new Blob([u8], { type: b.getAttribute('content-type') ?? 'image/jpeg' })))
    }
    return blobs.get(id)!
  }
  const info = first(d, 'title-info')
  const author = info ? byTag(info, 'author').map((a) => [first(a, 'first-name'), first(a, 'last-name')].map((x) => x?.textContent?.trim()).filter(Boolean).join(' ')).filter(Boolean).join(', ') : ''
  const coverRef = info && first(info, 'coverpage') && first(first(info, 'coverpage'), 'image')
  const cover = coverRef ? image(coverRef.getAttribute('l:href') ?? coverRef.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '') : null

  // FB2 → HTML tags
  const map: Record<string, string> = { p: 'p', emphasis: 'em', strong: 'strong', strikethrough: 's', sub: 'sub', sup: 'sup', 'empty-line': 'br', epigraph: 'blockquote', cite: 'blockquote', poem: 'blockquote', stanza: 'div', v: 'p', 'text-author': 'p', subtitle: 'h3', title: 'h2', table: 'table', tr: 'tr', td: 'td', th: 'th', code: 'code' }
  const convert = (el: Element): string =>
    [...el.childNodes]
      .map((n) => {
        if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
        if (n.nodeType !== Node.ELEMENT_NODE) return ''
        const c = n as Element
        if (c.localName === 'section') return ''
        if (c.localName === 'image') {
          const u = image(c.getAttribute('l:href') ?? c.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '')
          return u ? `<img src="${u}" alt="">` : ''
        }
        const t = map[c.localName]
        if (t === 'br') return '<br>'
        return t ? `<${t}>${convert(c)}</${t}>` : convert(c)
      })
      .join('')

  const chapters: BookChapter[] = []
  const walk = (sec: Element, depth: number) => {
    const subs = [...sec.children].filter((c) => c.localName === 'section')
    const title = [...sec.children].find((c) => c.localName === 'title')?.textContent?.replace(/\s+/g, ' ').trim()
    const html = convert(sec)
    if (html.replace(/<[^>]+>/g, '').trim()) chapters.push({ title: title || `Глава ${chapters.length + 1}`, html })
    subs.forEach((s) => walk(s, depth + 1))
  }
  for (const body of byTag(d, 'body')) {
    if (body.getAttribute('name') === 'notes' || body.getAttribute('name') === 'comments') continue
    const secs = [...body.children].filter((c) => c.localName === 'section')
    if (secs.length) secs.forEach((s) => walk(s, 0))
    else walk(body, 0)
  }
  return { title: info ? (first(info, 'book-title')?.textContent?.trim() ?? '') : '', author, cover: cover ?? '', chapters }
}

function parseTxt(bytes: Uint8Array, name: string): Parsed {
  const text = decode(bytes).replace(/\r/g, '')
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  // lines like "Глава 12" or "Chapter 12: …" start a new chapter
  const head = /^\s*((глава|часть|пролог|эпилог|chapter|prologue|epilogue)(?=[\s\d.:,—-]|$).{0,80})$/iu
  const chapters: BookChapter[] = []
  let cur: { title: string; lines: string[] } = { title: 'Начало', lines: [] }
  const flush = () => {
    if (cur.lines.some((l) => l.trim())) chapters.push({ title: cur.title, html: cur.lines.filter((l) => l.trim()).map((l) => `<p>${esc(l.trim())}</p>`).join('') })
  }
  for (const line of text.split('\n')) {
    const m = head.exec(line)
    if (m) {
      flush()
      cur = { title: m[1].trim(), lines: [] }
    } else cur.lines.push(line)
  }
  flush()
  return { title: name.replace(/\.txt$/i, ''), author: '', cover: '', chapters }
}

function parse(bytes: Uint8Array, format: Book['format'], name: string): Parsed {
  if (format === 'epub') return parseEpub(bytes)
  if (format === 'fb2') {
    // .fb2.zip holds a single .fb2
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const z = unzipSync(bytes)
      const f = Object.keys(z).find((k) => k.toLowerCase().endsWith('.fb2'))
      if (!f) throw new Error('В архиве нет файла .fb2')
      return parseFb2(z[f])
    }
    return parseFb2(bytes)
  }
  return parseTxt(bytes, name)
}

const parsedCache = new Map<string, Parsed>()

/** small cover thumbnail stored with the book entry, so the shelf needs no parsing */
async function thumb(url: string) {
  if (!url) return ''
  const img = new Image()
  img.src = url
  await img.decode().catch(() => null)
  if (!img.naturalWidth) return ''
  const c = document.createElement('canvas')
  c.width = 240
  c.height = Math.round((240 * img.naturalHeight) / img.naturalWidth)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.8)
}

export async function importBook(file: File): Promise<Book> {
  const lower = file.name.toLowerCase()
  const format: Book['format'] | null = lower.endsWith('.epub') ? 'epub' : lower.endsWith('.fb2') || lower.endsWith('.fb2.zip') ? 'fb2' : lower.endsWith('.txt') ? 'txt' : null
  if (!format) throw new Error('Поддерживаются EPUB, FB2 и TXT')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const parsed = parse(bytes, format, file.name)
  if (!parsed.chapters.length) throw new Error('В книге не нашлось текста')
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))
  const id = [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const existing = useBooks.getState().books[id]
  if (existing) return existing
  await keepStorage()
  const name = `book.${format === 'fb2' && lower.endsWith('.zip') ? 'fb2.zip' : format}`
  await storage.write(`book-${id}/${name}`, bytes)
  parsedCache.set(id, parsed)
  const book: Book = {
    id,
    title: parsed.title || file.name.replace(/\.(epub|fb2|txt|zip)+$/gi, ''),
    author: parsed.author,
    format,
    file: name,
    size: bytes.length,
    cover: await thumb(parsed.cover),
    chapters: parsed.chapters.length,
    addedAt: Date.now(),
    chapter: 0,
    frac: 0,
    readAt: 0,
  }
  useBooks.getState().add(book)
  return book
}

export async function openBook(b: Book) {
  const hit = parsedCache.get(b.id)
  if (hit) return hit
  const bytes = await storage.read(`book-${b.id}/${b.file}`)
  const parsed = parse(bytes, b.format, b.title)
  parsedCache.set(b.id, parsed)
  return parsed
}
