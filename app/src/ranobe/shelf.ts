// Online ranobe ride on the manga shelf (and its sync to the account) under ids of their own: "ln-<source>-<novel>".
import { useMemo } from 'react'
import { useManga, type MangaEntry } from '../manga/store'
import type { NovelItem } from './sources'

export const entryId = (src: string, novelId: string) => `ln-${src}-${encodeURIComponent(novelId)}`
export const isNovelEntry = (id: string) => id.startsWith('ln-')
export function parseEntry(id: string) {
  const [, src, ...rest] = id.split('-')
  return { src, novelId: decodeURIComponent(rest.join('-')) }
}
/** a key safe for file names, for the translated chapters kept on the device */
export const fileKey = (id: string) => id.replace(/[^a-z0-9-]/gi, '_').slice(0, 120)

export const novelPath = (src: string, novelId: string) => `/ranobe/n/${src}/${encodeURIComponent(novelId)}`
export const chapterPath = (src: string, novelId: string, chapterId: string) => `${novelPath(src, novelId)}/${encodeURIComponent(chapterId)}`

export function rememberNovel(src: string, n: NovelItem, lang: string) {
  const id = entryId(src, n.id)
  useManga.getState().touch({ id, title: n.title, cover: n.cover, lang }, { kind: 'Ранобэ', lang })
  return id
}

/** novels being read, newest first */
export function useReadingNovels(): MangaEntry[] {
  const entries = useManga((s) => s.entries)
  return useMemo(
    () => Object.values(entries).filter((e) => isNovelEntry(e.id) && (e.lastChapterId || e.status || e.favorite)).sort((a, b) => (b.lastReadAt ?? b.updatedAt) - (a.lastReadAt ?? a.updatedAt)),
    [entries],
  )
}
