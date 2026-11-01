import { useMemo } from 'react'
import { useStore, type Progress, type TitleEntry } from './store'
import type { ProfileStats } from './social'
import type { MalEpisodes } from './achievements'

/** episodes watched per anime as this device knows them: themed achievements count before the server catches up */
export function localMalEps(titles: Record<string, TitleEntry>, progress: Record<string, Progress>): MalEpisodes {
  const out: MalEpisodes = {}
  for (const p of Object.values(progress)) {
    const mal = p.watched && titles[p.releaseId]?.malId
    if (!mal) continue
    const e = (out[mal] ??= [0, 0])
    e[0]++
    e[1] = Math.max(e[1], Math.floor(p.ordinal))
  }
  return out
}

export function useLocalMalEps() {
  const titles = useStore((s) => s.titles)
  const progress = useStore((s) => s.progress)
  return useMemo(() => localMalEps(titles, progress), [titles, progress])
}

/** the server's numbers with this device's on top, whichever is bigger */
export function withLocal<T extends ProfileStats>(s: T, local: MalEpisodes): T {
  const m = { ...s.mal_eps }
  for (const [k, [n, top]] of Object.entries(local)) m[k] = [Math.max(n, m[k]?.[0] ?? 0), Math.max(top, m[k]?.[1] ?? 0)]
  return { ...s, mal_eps: m }
}
