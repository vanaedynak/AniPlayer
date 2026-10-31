// Novels and chapters opened in this run of the app: the title page, the reader and the next chapter
// share one request instead of three.
import { sourceById } from './registry'
import type { Novel } from './sources'

const novels = new Map<string, Promise<Novel>>()
const chapters = new Map<string, Promise<string>>()

function once<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>) {
  let p = map.get(key)
  if (!p) {
    p = load()
    map.set(key, p)
    p.catch(() => map.delete(key))
  }
  return p
}

export function loadNovel(src: string, id: string) {
  const s = sourceById(src)
  if (!s) return Promise.reject(new Error('Неизвестный источник'))
  return once(novels, `${src}:${id}`, () => s.novel(id))
}

export function loadChapter(src: string, novelId: string, chapterId: string) {
  const s = sourceById(src)
  if (!s) return Promise.reject(new Error('Неизвестный источник'))
  return once(chapters, `${src}:${chapterId}`, () => s.chapter(novelId, chapterId))
}
