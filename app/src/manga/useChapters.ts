import { useMemo } from 'react'
import { chapters, dedupe } from './md'
import { useManga } from './store'
import { useAsync } from '../lib/useAsync'

/** the language to read a title in: the one picked for it, else the preferred one, else whatever exists */
export function pickLang(langs: string[], chosen: string | undefined, preferred: string) {
  if (chosen && langs.includes(chosen)) return chosen
  if (preferred !== 'any' && langs.includes(preferred)) return preferred
  return ['ru', 'en', 'uk'].find((l) => langs.includes(l)) ?? langs[0] ?? 'en'
}

/** a title's chapters in one language, one version per chapter number */
export function useChapters(mangaId: string, lang: string | null) {
  const group = useManga((s) => s.entries[mangaId]?.group)
  const all = useAsync(() => (lang ? chapters(mangaId, lang) : Promise.resolve([])), [mangaId, lang])
  const list = useMemo(() => (all.data ? dedupe(all.data, group) : []), [all.data, group])
  const groups = useMemo(() => [...new Set((all.data ?? []).map((c) => c.group).filter(Boolean))], [all.data])
  return { list, all: all.data ?? [], groups, loading: all.loading, error: all.error }
}
