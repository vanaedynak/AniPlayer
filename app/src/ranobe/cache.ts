// Novels and chapters opened in this run of the app: the title page, the reader and the next chapter
// share one request instead of three. Downloaded chapters are read from the device.
import { sourceById } from './registry'
import type { Novel } from './sources'
import { entryId } from './shelf'
import { savedChapter, savedMeta, savedText } from '../manga/saved'

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
  // with no connection, the copy kept along with downloaded chapters
  return once(novels, `${src}:${id}`, () =>
    s.novel(id).catch(async (e) => {
      const copy = await savedMeta<Novel>(entryId(src, id))
      if (copy) return copy
      throw e
    }),
  )
}

/** a chapter's HTML: from the device when it was downloaded (unless `fresh`), else from the source */
export function loadChapter(src: string, novelId: string, chapterId: string, fresh = false) {
  const s = sourceById(src)
  if (!s) return Promise.reject(new Error('Неизвестный источник'))
  const saved = !fresh && savedChapter(entryId(src, novelId), chapterId)
  if (saved) return savedText(saved).catch(() => s.chapter(novelId, chapterId))
  return once(chapters, `${src}:${chapterId}`, () => s.chapter(novelId, chapterId))
}
