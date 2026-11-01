import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { profileStats, useMyProfile } from '../lib/social'
import { evaluate, RARITY, type Achievement } from '../lib/achievements'
import { useLocalMalEps, withLocal } from '../lib/myAchievements'
import { useStore } from '../lib/store'
import { useManga } from '../manga/store'

const SEEN = (id: string) => `anyflow-ach-seen:${id}`

function readSeen(id: string): string[] | null {
  try {
    return JSON.parse(localStorage.getItem(SEEN(id)) ?? 'null')
  } catch {
    return null
  }
}

/**
 * «Достижение получено»: pops up when something new is earned, the way Jut.su did. Checks a while after
 * an episode or chapter is finished (the server needs the synced numbers), and when the app comes back.
 * The first check on a device only remembers what is already earned.
 */
export function AchievementToasts() {
  const me = useMyProfile()
  const local = useLocalMalEps()
  const localRef = useRef(local)
  localRef.current = local
  const watched = useStore((s) => Object.values(s.progress).reduce((n, p) => n + (p.watched ? 1 : 0), 0))
  const read = useManga((s) => Object.keys(s.entries).length + Object.values(s.entries).reduce((n, e) => n + (e.updatedAt ?? 0), 0))
  const [tick, setTick] = useState(0)
  const [queue, setQueue] = useState<Achievement[]>([])
  const first = useRef(true)
  const nav = useNavigate()

  useEffect(() => {
    const again = () => document.visibilityState === 'visible' && setTick((t) => t + 1)
    document.addEventListener('visibilitychange', again)
    const id = setInterval(again, 10 * 60_000)
    return () => {
      document.removeEventListener('visibilitychange', again)
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    if (!me) return
    const t = setTimeout(
      async () => {
        first.current = false
        const stats = await profileStats(me.id).catch(() => null)
        if (!stats) return
        const done = evaluate(withLocal({ ...stats, created_at: me.created_at }, localRef.current))
          .filter((x) => x.done)
          .map((x) => x.a)
        const seen = readSeen(me.id)
        const fresh = seen ? done.filter((a) => !seen.includes(a.id)) : []
        try {
          localStorage.setItem(SEEN(me.id), JSON.stringify([...new Set([...(seen ?? []), ...done.map((a) => a.id)])]))
        } catch {
          /* private mode: toasts may repeat, nothing breaks */
        }
        if (fresh.length) setQueue((q) => [...q, ...fresh])
      },
      first.current ? 4000 : 20_000,
    )
    return () => clearTimeout(t)
  }, [me, watched, read, tick])

  const cur = queue[0]
  useEffect(() => {
    if (!cur) return
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 7000)
    return () => clearTimeout(t)
  }, [cur])

  if (!cur) return null
  const r = RARITY[cur.rarity]
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[95] flex justify-center px-4" style={{ top: 'calc(var(--safe-top) + 76px)' }}>
      <div
        key={cur.id}
        role="status"
        onClick={() => {
          setQueue((q) => q.slice(1))
          nav(`/achievements?a=${cur.id}`)
        }}
        className="animate-pop pointer-events-auto relative flex w-full max-w-md cursor-pointer items-center gap-3 overflow-hidden rounded-3xl bg-card/95 p-3 pr-10 shadow-2xl backdrop-blur-xl"
        style={{
          boxShadow: `inset 0 0 0 1px ${r.color}88, 0 18px 50px -12px ${r.color}88`,
        }}
      >
        <div className="pointer-events-none absolute -top-12 -left-8 h-32 w-32 rounded-full opacity-40 blur-2xl" style={{ background: r.color }} />
        <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-3xl" style={{ background: `${r.color}26` }}>
          {cur.icon}
        </span>
        <span className="relative min-w-0">
          <span className="block text-[11px] font-extrabold tracking-wide uppercase" style={{ color: r.color }}>
            Достижение получено · {r.label}
          </span>
          <span className="block truncate text-base font-extrabold">{cur.label}</span>
          <span className="block truncate text-xs text-muted">{cur.hint}</span>
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setQueue((q) => q.slice(1))
          }}
          className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-white"
          aria-label="Закрыть"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
