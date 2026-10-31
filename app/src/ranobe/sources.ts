// Online ranobe sources, one adapter each, shaped like LNReader's plugins
// (popularNovels / searchNovels / parseNovelAndChapters / parseChapter).
import { CapacitorHttp } from '@capacitor/core'
import { isNative } from '../lib/platform'

export interface NovelItem {
  id: string
  title: string
  cover: string
  /** a line under the title: status, chapters, year */
  sub?: string
}

export interface ChapterRef {
  id: string
  title: string
  volume?: string
}

export interface Novel extends NovelItem {
  original?: string
  summary: string
  status?: string
  genres: string[]
  chapters: ChapterRef[]
}

export interface Sort {
  value: string
  label: string
}

export interface Source {
  id: string
  name: string
  lang: 'ru' | 'en'
  note: string
  sorts: Sort[]
  popular(page: number, sort: string): Promise<{ items: NovelItem[]; more: boolean }>
  search(q: string): Promise<NovelItem[]>
  novel(id: string): Promise<Novel>
  /** chapter text as HTML */
  chapter(novelId: string, chapterId: string): Promise<string>
}

/**
 * GET for sites that send no CORS headers: the apps ask natively, Electron adds the header,
 * the dev server goes through Vite's proxy (`dev` is its path prefix).
 */
export async function getText(url: string, dev?: { from: string; to: string }): Promise<string> {
  if (isNative) {
    const res = await CapacitorHttp.get({ url, responseType: 'text' })
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
  }
  const res = await fetch(import.meta.env.DEV && dev ? url.replace(dev.from, dev.to) : url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export const getJson = async <T,>(url: string, dev?: { from: string; to: string }) => JSON.parse(await getText(url, dev)) as T

/** plain text out of an HTML fragment */
export const stripTags = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html').body.textContent?.replace(/\s+\n/g, '\n').trim() ?? ''
