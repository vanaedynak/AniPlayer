import { useMemo } from 'react'
import { chapters, dedupe } from './md'
import { skChapters } from './sk'
import { useManga } from './store'
import { useAsync } from '../lib/useAsync'

/** the language to read a title in: the one picked for it, else the preferred one, else whatever exists */
export function pickLang(langs: string[], chosen: string | undefined, preferred: string) {
  if (chosen && langs.includes(chosen)) return chosen
  if (preferred !== 'any' && langs.includes(preferred)) return preferred
  return ['ru', 'en', 'uk'].find((l) => langs.includes(l)) ?? langs[0] ?? 'en'
}

/** a title's chapters in one language, one version per chapter number */
export function useChapters(mangaId: string, lang: string | null, sk?: string) {
  const group = useManga((s) => s.entries[mangaId]?.group)
  // MangaDex and Senkuro together: the gaps in one are often filled by the other
  const all = useAsync(async () => {
    if (!lang) return { main: [], more: [] }
    const mdOnly = mangaId.startsWith('sk-')
    const [md, ru, en] = await Promise.all([
      mdOnly ? [] : chapters(mangaId, lang),
      lang === 'ru' && sk ? skChapters(sk).catch(() => []) : [],
      // chapters nobody has translated into this language yet are read in English
      lang !== 'en' && !mdOnly ? chapters(mangaId, 'en').catch(() => []) : [],
    ])
    return { main: [...md, ...ru], more: en }
  }, [mangaId, lang, sk])
  const list = useMemo(() => {
    if (!all.data) return []
    const main = dedupe(all.data.main, group)
    const last = Math.max(-1, ...main.map((c) => (c.num != null ? parseFloat(c.num) : -1)))
    const tail = dedupe(all.data.more).filter((c) => c.num != null && parseFloat(c.num) > last && !c.external)
    return [...main, ...tail]
  }, [all.data, group])
  const groups = useMemo(() => [...new Set((all.data?.main ?? []).map((c) => c.group).filter(Boolean))], [all.data])
  const every = useMemo(() => (all.data ? [...all.data.main, ...all.data.more] : []), [all.data])
  return { list, all: every, groups, loading: all.loading, error: all.error }
}
