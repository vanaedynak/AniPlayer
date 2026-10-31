import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, Clock, Loader2 } from 'lucide-react'
import { api, sortedEpisodes, type Episode, type Release } from '../lib/api'
import { franchiseParts, shiki, shikiTitle, shikiToRelease, type ShikiAnime } from '../lib/shikimori'
import { kodikNumbers } from '../lib/yummy'
import { useLibriaIndex } from '../lib/libriaIndex'
import { useAsync } from '../lib/useAsync'
import { EpisodeCard, Empty } from './ui'
import { cn } from '../lib/format'

export interface SeasonItem {
  key: string
  /** number across the whole season */
  num: number
  r: Release
  e: Episode
  to: string | null
}
interface SeasonPart {
  title: string
  items: SeasonItem[]
}

/** the season a title belongs to: its parts ("Сезон 2 · Часть 1…4") together */
async function seasonOf(malId: number): Promise<ShikiAnime[]> {
  const parts = await franchiseParts(malId).catch(() => [])
  const me = parts.find((p) => p.a.id === malId)
  if (me?.main) {
    const season = me.label.split(' · ')[0]
    return parts.filter((p) => p.main && p.label.split(' · ')[0] === season).map((p) => p.a)
  }
  return [me?.a ?? (await shiki.anime(malId))]
}

const kodikEpisode = (r: Release, n: number): Episode => ({
  id: `k${r.id}_${n}`,
  name: null,
  ordinal: n,
  hls_480: null,
  hls_720: null,
  hls_1080: null,
  duration: null,
  sort_order: n,
  release_id: r.id,
})

/**
 * Every episode of the season, whatever has it: AniLibria's own first, the ones it lacks from the
 * other dubs (Kodik), and the parts of a split season one after another.
 */
async function loadSeason(malId: number, current: Release | null): Promise<SeasonPart[]> {
  const parts = await seasonOf(malId)
  const byMal = useLibriaIndex.getState().byMal
  const loaded = await Promise.all(
    parts.map(async (a) => {
      const alias = byMal[a.id]?.alias
      const lib = current?.mal?.id === a.id && current.episodes ? current : alias ? await api.release(alias).catch(() => null) : null
      const own = lib ? sortedEpisodes(lib) : []
      const aired = a.status === 'ongoing' ? a.episodes_aired : a.episodes || a.episodes_aired
      const kodik = !lib || own.length < aired ? await kodikNumbers(a).catch(() => [] as number[]) : []
      return { a, lib, own, aired, kodik }
    }),
  )
  let offset = 0
  return loaded.map(({ a, lib, own, aired, kodik }) => {
    const sr = shikiToRelease(a)
    const byOrd = new Map(own.map((e) => [e.ordinal, e]))
    const nums = new Set<number>([...byOrd.keys(), ...kodik])
    for (let n = 1; n <= aired; n++) nums.add(n)
    const items = [...nums]
      .sort((x, y) => x - y)
      .map((n): SeasonItem => {
        const e = byOrd.get(n)
        if (e && lib) return { key: e.id, num: offset + n, r: lib, e, to: `/watch/${lib.alias}/${n}` }
        return { key: `k${a.id}_${n}`, num: offset + n, r: sr, e: kodikEpisode(sr, n), to: kodik.includes(n) ? `/anime/${a.id}?kodik=1&ep=${n}` : null }
      })
    offset += Math.floor(Math.max(0, ...nums))
    return { title: shikiTitle(a), items }
  })
}

const fromRelease = (r: Release): SeasonPart[] => [
  { title: r.name.main, items: sortedEpisodes(r).map((e) => ({ key: e.id, num: e.ordinal, r, e, to: `/watch/${r.alias}/${e.ordinal}` })) },
]

/** one grid with all the episodes of the season, like a streaming site: no ranges to page through */
export function SeasonEpisodes({
  release,
  malId,
  current,
  replace,
}: {
  /** the AniLibria release on this page, shown right away while the rest loads */
  release: Release | null
  malId?: number | null
  /** the episode playing (or to resume), highlighted */
  current?: { releaseId: number; ordinal: number }
  replace?: boolean
}) {
  const id = `${malId}:${release?.id}`
  const res = useAsync(
    () => (malId ? loadSeason(malId, release) : Promise.resolve(release ? fromRelease(release) : [])).then((parts) => ({ id, parts })),
    [id],
  )
  // the previous season stays in state while the next one loads: never show it
  const data = res.data?.id === id ? res.data.parts : null
  const loading = !data && !res.error
  const parts = data ?? (release ? fromRelease(release) : [])
  const [reverse, setReverse] = useState(false)
  const [jump, setJump] = useState('')
  const [flash, setFlash] = useState<number | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const total = useMemo(() => parts.reduce((s, p) => s + p.items.length, 0), [parts])
  const many = parts.length > 1

  useEffect(() => {
    if (flash == null) return
    const t = setTimeout(() => setFlash(null), 1600)
    return () => clearTimeout(t)
  }, [flash])

  const goTo = (n: number) => {
    const el = grid.current?.querySelector<HTMLElement>(`[data-num="${n}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(n)
  }

  const shown = reverse ? [...parts].reverse().map((p) => ({ ...p, items: [...p.items].reverse() })) : parts
  return (
    <section className="flex flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-2xl font-extrabold">
          Серии {total > 0 && <span className="text-base font-semibold text-muted">· {total}</span>}
          {loading && <Loader2 size={18} className="animate-spin text-muted" />}
        </h2>
        {total > 1 && (
          <div className="flex items-center gap-2">
            {total > 12 && (
              <form
                onSubmit={(ev) => {
                  ev.preventDefault()
                  goTo(Number(jump))
                }}
              >
                <input
                  value={jump}
                  onChange={(ev) => setJump(ev.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                  placeholder="Номер"
                  title="Перейти к серии"
                  className="h-9 w-24 rounded-full bg-card-2 px-4 text-sm font-bold ring-1 ring-white/10 outline-none placeholder:text-white/40 focus:ring-white/30"
                />
              </form>
            )}
            <button
              onClick={() => setReverse(!reverse)}
              title="Порядок"
              className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-white/10', reverse ? 'bg-white text-black' : 'bg-card-2')}
            >
              <ArrowDownUp size={16} />
            </button>
          </div>
        )}
      </div>
      {total ? (
        <div ref={grid} className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-4">
          {shown.map((p, i) => [
            many && (
              <div key={`h${i}`} className={cn('col-span-full flex items-baseline gap-2 font-extrabold', i > 0 && 'mt-4')}>
                Часть {reverse ? parts.length - i : i + 1}
                <span className="truncate text-sm font-semibold text-muted">{p.title}</span>
              </div>
            ),
            ...p.items.map((it) => (
              <div key={it.key} data-num={it.num} className={cn('scroll-mt-24 rounded-2xl transition', flash === it.num && 'ring-2 ring-accent-2 ring-offset-4 ring-offset-bg')}>
                <EpisodeCard
                  r={it.r}
                  e={it.e}
                  num={it.num}
                  to={it.to ?? undefined}
                  missing={!it.to}
                  replace={replace}
                  active={current?.releaseId === it.r.id && current.ordinal === it.e.ordinal}
                />
              </div>
            )),
          ])}
        </div>
      ) : loading ? null : (
        <Empty icon={<Clock />} title="Серий пока нет" text={release?.notification ?? 'Загляните позже.'} />
      )}
    </section>
  )
}
