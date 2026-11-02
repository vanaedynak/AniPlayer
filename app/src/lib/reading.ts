// What the readers need from the device and from the person reading: the screen stays on while someone
// reads (and is let go once they walk away), and their own pace is learned so the reader can say how
// much of the chapter is left in minutes.
import { useEffect, useRef, useState } from 'react'
import { KeepAwake } from '@capacitor-community/keep-awake'
import { isNative } from './platform'

// --- the screen stays on ---------------------------------------------------------------------------

type Sentinel = { release: () => Promise<void> }
type WakeNav = Navigator & {
  wakeLock?: { request: (t: 'screen') => Promise<Sentinel> }
}

/** keeps the screen from dimming while `on`; let go when off, hidden or unmounted */
export function useStayAwake(on: boolean) {
  useEffect(() => {
    if (!on) return
    let lock: Sentinel | null = null
    let alive = true
    const take = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        if (isNative) await KeepAwake.keepAwake()
        else if (!lock) {
          const l = await (navigator as WakeNav).wakeLock?.request('screen')
          if (!alive) void l?.release()
          else lock = l ?? null
        }
      } catch {
        /* not supported here, or the system said no (battery saver): nothing to do */
      }
    }
    // the browser drops the lock whenever the page is hidden; it has to be asked for again
    const onVis = () => {
      if (document.visibilityState === 'visible') void take()
      else lock = null
    }
    void take()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVis)
      if (isNative) void KeepAwake.allowSleep().catch(() => {})
      void lock?.release().catch(() => {})
    }
  }, [on])
}

// --- is anyone there -------------------------------------------------------------------------------

const EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart', 'scroll'] as const

/**
 * False once nobody has touched the reader for `after` ms: the page has been left open. While someone is
 * there the screen stays on; once they are gone it is let go and the system dims it as usual.
 * `busy` (reading aloud) counts as being there.
 */
export function usePresence(after: number, busy = false) {
  const [here, setHere] = useState(true)
  const last = useRef(Date.now())
  useEffect(() => {
    const touch = (e: Event) => {
      // a resting mouse on the PC still reports tiny moves; only a real one counts
      if (e.type === 'pointermove' && (e as PointerEvent).pointerType !== 'mouse') return
      last.current = Date.now()
      setHere(true)
    }
    EVENTS.forEach((e) => window.addEventListener(e, touch, { capture: true, passive: true }))
    const t = setInterval(() => setHere(Date.now() - last.current < after), 5000)
    return () => {
      clearInterval(t)
      EVENTS.forEach((e) => window.removeEventListener(e, touch, { capture: true }))
    }
  }, [after])
  const present = here || busy
  useStayAwake(present)
  return present
}

// --- reading pace ----------------------------------------------------------------------------------

/** seconds per manga page, words per minute of ranobe */
interface Pace {
  page: number
  wpm: number
}
const PACE_KEY = 'aniplayer-pace'
const DEFAULT: Pace = { page: 12, wpm: 180 }

function loadPace(): Pace {
  try {
    return {
      ...DEFAULT,
      ...JSON.parse(localStorage.getItem(PACE_KEY) ?? '{}'),
    }
  } catch {
    return DEFAULT
  }
}
let pace = loadPace()
function learn(k: keyof Pace, v: number, weight: number) {
  pace = { ...pace, [k]: pace[k] + (v - pace[k]) * Math.min(0.3, weight) }
  try {
    localStorage.setItem(PACE_KEY, JSON.stringify(pace))
  } catch {
    /* ignore */
  }
}

export const pagePace = () => pace.page
export const textPace = () => pace.wpm

/** how long nobody touching the reader means they have gone: a few of their pages, never under two minutes */
export const awayAfter = (perScreen: number) => Math.max(120_000, perScreen * 4 * 1000)

/**
 * Seconds a manga page takes this reader, learned from their page turns. A turn after a pause
 * (the page left open) or a flip through teaches nothing.
 */
export function usePagePace(page: number, present: boolean) {
  const since = useRef(Date.now())
  const wasAway = useRef(false)
  const [sec, setSec] = useState(pace.page)
  useEffect(() => {
    if (!present) wasAway.current = true
  }, [present])
  useEffect(() => {
    const dt = (Date.now() - since.current) / 1000
    if (!wasAway.current && dt > 1.5 && dt < Math.max(120, pace.page * 4)) {
      learn('page', dt, 0.15)
      setSec(pace.page)
    }
    since.current = Date.now()
    wasAway.current = false
  }, [page])
  return sec
}

/**
 * Words a minute this reader reads, learned from how far into the chapter they get (0…1 of `words`)
 * while actually there. Checked every 20 s; jumps (the progress bar, a chapter list) teach nothing.
 */
export function useTextPace(words: number, frac: number, present: boolean) {
  const [wpm, setWpm] = useState(pace.wpm)
  const at = useRef(frac)
  const fracRef = useRef(frac)
  fracRef.current = frac
  useEffect(() => {
    at.current = fracRef.current
    if (!present || words < 50) return
    const t = setInterval(() => {
      const read = (fracRef.current - at.current) * words
      at.current = fracRef.current
      const v = read * 3 // in 20 s
      if (read > 5 && v > 40 && v < 1500) {
        learn('wpm', v, 0.1)
        setWpm(pace.wpm)
      }
    }, 20_000)
    return () => clearInterval(t)
  }, [present, words])
  return wpm
}

export const wordCount = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length

/** "≈ 7 мин" left; nothing when the chapter is done */
export function minutesLeft(sec: number) {
  if (sec < 20) return ''
  const m = Math.round(sec / 60)
  return m < 1 ? 'меньше минуты' : `≈ ${m} мин`
}
