// The downloads folder on the iPad keeps its own list of what is in it, library.json, so a reinstalled
// app (or a new version) picks the folder and finds everything again.
//
// Folder format 1. Later versions must keep reading it; a change that old files can't follow needs a new
// format number and code that still opens format 1.
//   library.json                  this list: { format, savedAt, episodes, chapters, books }
//   README.txt                    the same, for a person
//   <release>_<episode>/          an episode: index.m3u8 and its segments seg0.ts, seg1.ts…
//   ch-<title>-<chapter>.cbz      a manga chapter: a zip of its pages 001.jpg, 002.png… (stored, not compressed)
//   ch-<title>-<chapter>.zip      a ranobe chapter: a zip with text.html (compressed)
//   ch-<title>-<chapter>/         a chapter saved before archives: pages 0, 1, 2… or text.html
//   chm-<title>/meta.json         the title's data (chapter list), for opening it offline
//   book-<id>/<file>              a book added from a file (EPUB, FB2, TXT), as it was
import { storage, folderSupported, useFolder, whenFolderKnown, pickFolder, adoptOldDownloads } from './offline'
import { useDownloads, type DlItem } from './downloads'
import type { Release } from './api'
import { useSaved, type SavedChapter, type SavedTitle } from '../manga/saved'
import { useBooks, type Book } from '../manga/books'

const FILE = 'library.json'
const FORMAT = 1

interface Library {
  format: number
  app: string
  savedAt: number
  episodes: { items: Record<string, DlItem>; releases: Record<string, Release> }
  chapters: { items: Record<string, SavedChapter>; titles: Record<string, SavedTitle> }
  books: Record<string, Book>
}

const README = `Anyflow: загрузки
=================

Здесь лежит всё, что скачано в приложении Anyflow: серии, главы манги и ранобэ, книги.
Папка не удаляется вместе с приложением. После переустановки откройте «Загрузки» → «Выбрать папку»
и укажите эту же папку: приложение прочитает library.json и снова покажет всё скачанное.

Что где (формат ${FORMAT}):
  library.json                 список скачанного
  <номер>_<серия>/             серия: index.m3u8 и куски seg0.ts, seg1.ts…
  ch-<тайтл>-<глава>.cbz       глава манги: zip со страницами 001.jpg, 002.png… (открывается любой читалкой комиксов)
  ch-<тайтл>-<глава>.zip       глава ранобэ: zip с text.html
  chm-<тайтл>/meta.json        данные тайтла (список глав)
  book-<id>/                   книга из файла (EPUB, FB2, TXT) как есть

Не переименовывайте и не перекладывайте файлы внутри: приложение ищет их по этим именам.
`

const done = <T extends { status: string }>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v.status === 'done'))

function build(): Library {
  const d = useDownloads.getState()
  const s = useSaved.getState()
  const items = done(d.items)
  const aliases = new Set(Object.values(items).map((i) => i.alias))
  const chapters = done(s.items)
  const entries = new Set(Object.values(chapters).map((i) => i.entry))
  return {
    format: FORMAT,
    app: 'Anyflow',
    savedAt: Date.now(),
    episodes: { items, releases: Object.fromEntries(Object.entries(d.releases).filter(([a]) => aliases.has(a))) },
    chapters: { items: chapters, titles: Object.fromEntries(Object.entries(s.titles).filter(([e]) => entries.has(e))) },
    books: useBooks.getState().books,
  }
}

async function read(): Promise<Library | null> {
  try {
    const lib = JSON.parse(new TextDecoder().decode(await storage.read(FILE))) as Library
    return typeof lib.format === 'number' ? lib : null
  } catch {
    return null
  }
}

/** what the folder holds and the app doesn't know about (a fresh install) comes back into the lists */
function merge(lib: Library) {
  const d = useDownloads.getState()
  const items = { ...d.items }
  const releases = { ...d.releases }
  for (const [k, it] of Object.entries(lib.episodes?.items ?? {})) if (!items[k] && it.status === 'done') items[k] = it
  for (const [a, r] of Object.entries(lib.episodes?.releases ?? {})) if (!releases[a]) releases[a] = r
  useDownloads.setState({ items, releases })

  const s = useSaved.getState()
  const chapters = { ...s.items }
  const titles = { ...s.titles }
  for (const [k, it] of Object.entries(lib.chapters?.items ?? {})) if (!chapters[k] && it.status === 'done') chapters[k] = it
  for (const [e, t] of Object.entries(lib.chapters?.titles ?? {})) if (!titles[e]) titles[e] = t
  useSaved.setState({ items: chapters, titles })

  const books = { ...useBooks.getState().books }
  for (const [id, b] of Object.entries(lib.books ?? {})) if (!books[id]) books[id] = b
  useBooks.setState({ books })
}

let last = ''
async function save() {
  if (!useFolder.getState().name) return
  const lib = build()
  const text = JSON.stringify({ ...lib, savedAt: 0 })
  if (text === last) return
  last = text
  await storage.write(FILE, JSON.stringify(lib)).catch(() => (last = ''))
}

// a chapter being saved changes the lists many times a second: the file is written at most every few seconds
let timer = 0
const soon = () => {
  if (!timer) timer = window.setTimeout(() => ((timer = 0), void save()), 5000)
}

async function openFolder() {
  const lib = await read()
  if (lib) merge(lib)
  await storage.write('README.txt', README).catch(() => {})
  await save()
}

export function initLibrary() {
  if (!folderSupported) return
  void whenFolderKnown().then(async () => {
    if (useFolder.getState().name) await openFolder()
    useDownloads.subscribe(soon)
    useSaved.subscribe(soon)
    useBooks.subscribe(soon)
  })
}

/** picks the folder, takes in what it already holds and moves the old downloads over; null when cancelled */
export async function chooseFolder() {
  if (!(await pickFolder())) return null
  last = ''
  const moved = await adoptOldDownloads()
  await openFolder()
  return moved
}
