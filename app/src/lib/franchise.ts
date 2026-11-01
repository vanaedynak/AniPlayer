import { useEffect, useMemo, useState } from 'react'
import { shikiMeta, type ShikiMeta } from './shikimori'
import { useStore, type TitleEntry } from './store'

/**
 * Seasons, films and OVAs of one anime shown as one thing: «Терраса кафе богинь», not «…» and «… 2»
 * side by side. Shikimori knows which franchise every title belongs to; the rest is naming.
 */

/** Shikimori's franchise of each MAL id, filled in as the answers arrive (remembered on the device) */
export function useFranchises(ids: (number | null | undefined)[]): Record<number, ShikiMeta> {
  const list = [...new Set(ids.filter((id): id is number => !!id && id > 0))].sort((a, b) => a - b)
  const key = list.join(',')
  const [meta, setMeta] = useState<Record<number, ShikiMeta>>({})
  useEffect(() => {
    if (!list.length) return
    let on = true
    shikiMeta(list).then((m) => on && setMeta({ ...m }))
    return () => {
      on = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return meta
}

/** the group key: the franchise when it is known, otherwise the title itself */
export const franchiseKey = (malId: number | null | undefined, meta: Record<number, ShikiMeta>, own: string) => (malId && meta[malId]?.franchise) || own

/** items grouped by franchise, groups in the order their first item comes */
export function groupByFranchise<T>(items: T[], malOf: (t: T) => number | null | undefined, ownKey: (t: T) => string, meta: Record<number, ShikiMeta>): T[][] {
  const map = new Map<string, T[]>()
  for (const t of items) {
    const k = franchiseKey(malOf(t), meta, ownKey(t))
    const g = map.get(k)
    if (g) g.push(t)
    else map.set(k, [t])
  }
  return [...map.values()]
}

const PUNCT = /[\s:;.,!?—–\-|/()«»"']+$/
const words = (s: string) => s.split(/\s+/).filter(Boolean)
const bare = (w: string) => w.toLowerCase().replace(/[:;.,!?—–\-]+$/, '')

/** the anime's own name from its parts' names: the words they all start with, or the first part's main title */
export function franchiseName(names: string[]): string {
  if (names.length < 2) return names[0] ?? ''
  const split = names.map(words)
  const common: string[] = []
  for (let i = 0; i < split[0].length; i++) {
    const w = bare(split[0][i])
    if (!split.every((n) => n[i] && bare(n[i]) === w)) break
    common.push(split[0][i])
  }
  const name = common.join(' ').replace(PUNCT, '')
  if (name.length >= 3) return name
  return names[0].split(/[:—]|\s-\s|\.\s/)[0].trim() || names[0]
}

const ROMAN: Record<string, number> = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 }

/** what tells this part apart: «Сезон 2», «Тысячелетняя кровавая война»; '' for the plain first one */
export function partLabel(name: string, base: string): string {
  const rest = name.toLowerCase().startsWith(base.toLowerCase()) ? name.slice(base.length).replace(/^[\s:;.,—–\-]+/, '').trim() : name
  if (!rest) return ''
  const n = /^(\d{1,2})$/.exec(rest)?.[1] ?? ROMAN[rest.toLowerCase()] ?? /^(?:season|сезон)\s*(\d{1,2})\b/i.exec(rest)?.[1] ?? /^(\d{1,2})(?:-?[йиго]{1,2})?\s+сезон/i.exec(rest)?.[1]
  return n ? `Сезон ${n}` : rest
}

export const partsWord = (n: number) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'часть' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'части' : 'частей'}`

/**
 * Search and catalog results folded into one card per anime: the card shows the season watched last
 * (or the best-ranked one), under the anime's own name. Its page switches between the seasons.
 */
export function useFolded<T>(items: T[], malOf: (t: T) => number | null | undefined, ownKey: (t: T) => string, nameOf: (t: T) => string, watchedAt?: (t: T) => number) {
  const meta = useFranchises(items.map(malOf))
  return useMemo(
    () =>
      groupByFranchise(items, malOf, ownKey, meta).map((parts) => {
        const seen = watchedAt ? [...parts].sort((a, b) => watchedAt(b) - watchedAt(a))[0] : undefined
        const lead = seen && watchedAt!(seen) > 0 ? seen : parts[0]
        return { key: ownKey(parts[0]), lead, parts, name: parts.length > 1 ? franchiseName(parts.map(nameOf)) : nameOf(lead), franchise: franchiseKey(malOf(lead), meta, ownKey(lead)) }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, meta],
  )
}

export interface TitleGroup {
  key: string
  name: string
  /** the parts in the collection or history, in airing order */
  parts: TitleEntry[]
}

const byAir = (a: TitleEntry, b: TitleEntry) => (a.year || 9999) - (b.year || 9999) || (a.malId ?? 0) - (b.malId ?? 0)

/** every title on this device placed in its franchise: the group's name and how each part is called in it */
export function useTitleGroups() {
  const titles = useStore((s) => s.titles)
  const list = useMemo(() => Object.values(titles), [titles])
  const meta = useFranchises(list.map((t) => t.malId))
  return useMemo(() => {
    const byRelease = new Map<number, TitleGroup>()
    for (const parts of groupByFranchise(list, (t) => t.malId, (t) => `t${t.releaseId}`, meta)) {
      parts.sort(byAir)
      const g: TitleGroup = { key: franchiseKey(parts[0].malId, meta, `t${parts[0].releaseId}`), name: franchiseName(parts.map((p) => p.name)), parts }
      for (const p of parts) byRelease.set(p.releaseId, g)
    }
    const groupOf = (releaseId: number) => byRelease.get(releaseId)
    /** «Сезон 2 · » before the episode, when the anime has more than one part here */
    const labelOf = (t: TitleEntry) => {
      const g = byRelease.get(t.releaseId)
      if (!g || g.parts.length < 2) return ''
      return partLabel(t.name, g.name) || (g.parts[0] === t ? 'Сезон 1' : '')
    }
    const nameOf = (t: TitleEntry) => byRelease.get(t.releaseId)?.name ?? t.name
    return { groupOf, labelOf, nameOf }
  }, [list, meta])
}
