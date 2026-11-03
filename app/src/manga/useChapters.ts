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
      // chapters nobody has translated into this language are read in English (Gemini translates them)
      lang !== 'en' && !mdOnly ? chapters(mangaId, 'en').catch(() => []) : [],
    ])
    return { main: [...md, ...ru], more: en }
  }, [mangaId, lang, sk])
  const list = useMemo(() => {
    if (!all.data) return []
    const main = dedupe(all.data.main, group)
    // every chapter missing in this language, wherever it is: a team often starts translating mid-way
    // (chapters 97 on), and the title would otherwise seem to begin there
    const have = new Set(main.map((c) => c.num))
    const fill = dedupe(all.data.more).filter((c) => c.num != null && !have.has(c.num) && !c.external)
    if (!fill.length) return main
    const at = (c: (typeof main)[number]) => (c.num != null ? parseFloat(c.num) : -1)
    return [...main, ...fill].sort((a, b) => at(a) - at(b))
  }, [all.data, group])
  const groups = useMemo(() => [...new Set((all.data?.main ?? []).map((c) => c.group).filter(Boolean))], [all.data])
  const every = useMemo(() => (all.data ? [...all.data.main, ...all.data.more] : []), [all.data])
  return { list, all: every, groups, loading: all.loading, error: all.error }
}
