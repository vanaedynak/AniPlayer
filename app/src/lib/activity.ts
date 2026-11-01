// What the leaderboards count besides watch time: reading time and finished episodes and chapters.
// Kept on the device until the next sync sends it with the watch time; the server caps it by the real clock.
import { useEffect } from 'react'
import { dayKey, syncHooks } from './store'

export type Activity = { r?: number; e?: number; c?: number; l?: number }

const PENDING_KEY = 'aniplayer-activity'
const COUNTED_KEY = 'aniplayer-counted'

function load<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

let pending = load<Record<string, Activity>>(PENDING_KEY, {})

function add(day: string, a: Activity) {
  const cur = (pending[day] ??= {})
  for (const [k, v] of Object.entries(a) as [keyof Activity, number][]) if (v > 0) cur[k] = (cur[k] ?? 0) + v
}

export function addActivity(a: Activity) {
  add(dayKey(), a)
  save(PENDING_KEY, pending)
  syncHooks.stats?.()
}

export function takeActivity() {
  const p = pending
  pending = {}
  save(PENDING_KEY, pending)
  return p
}

/** a report the server didn't get goes back in line */
export function restoreActivity(p: Record<string, Activity>) {
  for (const [d, a] of Object.entries(p)) add(d, a)
  save(PENDING_KEY, pending)
}

// an episode or chapter counts once on a device, however many times it is reopened
const counted = load<string[]>(COUNTED_KEY, [])
const countedSet = new Set(counted)

export function countFinished(kind: 'e' | 'c' | 'l', id: string) {
  const k = `${kind}:${id}`
  if (countedSet.has(k)) return
  countedSet.add(k)
  counted.push(k)
  if (counted.length > 5000) countedSet.delete(counted.shift()!)
  save(COUNTED_KEY, counted)
  addActivity({ [kind]: 1 })
}

/** reading time: counted while a reader is open, visible and in use (a page turn, scroll or tap in the last 90 s) */
export function useReadingClock(active = true) {
  useEffect(() => {
    if (!active) return
    let last = Date.now()
    const touch = () => (last = Date.now())
    const events = ['pointerdown', 'wheel', 'keydown', 'touchstart', 'scroll'] as const
    events.forEach((e) => window.addEventListener(e, touch, { capture: true, passive: true }))
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - last < 90_000) addActivity({ r: 5 })
    }, 5000)
    return () => {
      clearInterval(t)
      events.forEach((e) => window.removeEventListener(e, touch, { capture: true }))
    }
  }, [active])
}
