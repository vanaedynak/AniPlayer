import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { isIOS } from '../lib/platform'
import { rustleSound, turnSound, wakeAudio } from '../lib/paperSound'

/**
 * A page that turns like paper: pulled by its edge, it folds back along a line that follows the finger,
 * showing its blank back and the next page underneath; let go past the middle (or flicked) it turns over,
 * otherwise it falls back. A tap or a key turns it the same way on its own.
 *
 * The geometry is the classic one: the corner being pulled goes to the point P, the fold is the line
 * halfway between the corner and P, everything on the corner's side of it is lifted off (cut out of the
 * page) and drawn mirrored across the fold as the flap.
 */
export interface CurlHandle {
  /** turns the page with the animation; false when there is no page that way (the caller does it itself) */
  turn: (dir: 1 | -1) => boolean
}

type Pt = { x: number; y: number }
type Mode = 'next' | 'prev'

const DUR = 420

export const PageCurl = forwardRef<
  CurlHandle,
  {
    /** -1 the previous page, 0 the current one, 1 the next */
    render: (at: -1 | 0 | 1) => ReactNode
    canNext: boolean
    canPrev: boolean
    onNext: () => void
    onPrev: () => void
    /** pages turn left to right (manga read right to left) */
    rtl?: boolean
    /** the colour of the paper, front and back */
    paper: string
    /** off: just the page, no gestures (a zoomed page is panned instead) */
    enabled: boolean
    /** the swish of a turning page, and a rustle when a held one is shaken */
    sound?: boolean
    className?: string
  }
>(function PageCurl({ render, canNext, canPrev, onNext, onPrev, rtl, paper, enabled, sound, className }, ref) {
  const stage = useRef<HTMLDivElement>(null)
  const cur = useRef<HTMLDivElement>(null)
  const other = useRef<HTMLDivElement>(null)
  const shadow = useRef<HTMLDivElement>(null)
  const flap = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  // the gesture lives in refs: it moves every frame and must not re-render the pages
  const g = useRef<{
    mode: Mode
    p: Pt
    cy: number
    w: number
    h: number
  } | null>(null)
  const drag = useRef<{
    x: number
    y: number
    on: boolean
    lx: number
    ly: number
    lt: number
    v: number
    vy: number
    id: number
  } | null>(null)
  const anim = useRef<{ raf: number; done: () => void } | null>(null)
  const props = useRef({ canNext, canPrev, onNext, onPrev, rtl, sound })
  props.current = { canNext, canPrev, onNext, onPrev, rtl, sound }

  // draws the fold for the current point straight into the layers' styles
  const apply = useCallback(() => {
    const s = g.current
    const front = s?.mode === 'prev' ? other.current : cur.current
    if (!s || !front || !shadow.current || !flap.current) return
    const { w, h, cy } = s
    // the turn is worked out as if pages went right to left, then mirrored for manga
    const sx = (x: number) => (props.current.rtl ? w - x : x)
    const C = { x: sx(w), y: cy }
    const P = { x: sx(s.p.x), y: s.p.y }
    const n = { x: C.x - P.x, y: C.y - P.y }
    const len = Math.hypot(n.x, n.y)
    if (len < 0.5) {
      front.style.clipPath = ''
      shadow.current.style.background = 'none'
      flap.current.style.clipPath = 'polygon(0 0, 0 0, 0 0)'
      return
    }
    const u = { x: n.x / len, y: n.y / len }
    const M = { x: (C.x + P.x) / 2, y: (C.y + P.y) / 2 }
    const d = u.x * M.x + u.y * M.y
    const rect = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ]
    const lifted = cut(rect, u, d, true)
    front.style.clipPath = poly(cut(rect, u, d, false))
    // mirror image across the fold: q' = q - 2((u·q) - d)u
    const m = [1 - 2 * u.x * u.x, -2 * u.x * u.y, -2 * u.x * u.y, 1 - 2 * u.y * u.y, 2 * d * u.x, 2 * d * u.y]
    flap.current.style.transform = `matrix(${m.join(',')})`
    flap.current.style.clipPath = poly(lifted)
    // shading along the fold: a gradient across it, measured on the gradient line CSS draws for the box
    const angle = (Math.atan2(u.x, -u.y) * 180) / Math.PI
    const L = Math.abs(w * u.x) + Math.abs(h * u.y)
    const at = d - (u.x * w + u.y * h) / 2 + L / 2
    const sw = Math.min(90, len / 3 + 8)
    shadow.current.style.clipPath = poly(lifted)
    shadow.current.style.background = `linear-gradient(${angle}deg, transparent ${at}px, rgba(0,0,0,.45) ${at}px, rgba(0,0,0,.12) ${at + sw * 0.5}px, transparent ${at + sw}px)`
    flap.current.style.background = `linear-gradient(${angle}deg, rgba(0,0,0,.22) ${at}px, rgba(255,255,255,.18) ${at + sw * 0.35}px, rgba(0,0,0,.04) ${at + sw * 1.4}px, rgba(0,0,0,.14) ${L}px), ${paper}`
  }, [paper])

  // the layers of a new turn are on the page: give them their shape before the first paint
  useLayoutEffect(() => {
    if (mode) apply()
    else if (cur.current) cur.current.style.clipPath = ''
  }, [mode, apply])

  const begin = (m: Mode, cy: number) => {
    const r = stage.current!.getBoundingClientRect()
    const w = r.width
    g.current = {
      mode: m,
      p: { x: m === 'next' ? w : -w, y: cy * r.height },
      cy: cy * r.height,
      w,
      h: r.height,
    }
    setMode(m)
  }

  const finish = (commit: boolean) => {
    const s = g.current
    g.current = null
    anim.current = null
    if (s && commit) (s.mode === 'next' ? props.current.onNext : props.current.onPrev)()
    setMode(null)
  }

  /** moves P to `to` over `ms`, bowing upwards on the way when `arc` */
  const animate = (to: Pt, ms: number, done: () => void, arc = 0) => {
    const s = g.current
    if (!s) return done()
    const from = { ...s.p }
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms)
      const e = 1 - (1 - t) ** 3
      s.p = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e - Math.sin(Math.PI * t) * arc,
      }
      apply()
      if (t < 1) anim.current!.raf = requestAnimationFrame(tick)
      else done()
    }
    anim.current = { raf: requestAnimationFrame(tick), done }
  }

  /** a turn still running ends at once, as if it had finished */
  const flush = () => {
    const a = anim.current
    if (!a) return
    cancelAnimationFrame(a.raf)
    a.done()
  }

  useImperativeHandle(ref, () => ({
    turn: (dir) => {
      flush()
      const p = props.current
      if (!enabled || !stage.current || (dir > 0 ? !p.canNext : !p.canPrev)) return false
      const m: Mode = dir > 0 ? 'next' : 'prev'
      begin(m, 1)
      if (p.sound) turnSound()
      const s = g.current!
      requestAnimationFrame(() => animate({ x: m === 'next' ? -s.w : s.w, y: s.cy }, DUR, () => finish(true), s.h * 0.12))
      return true
    },
  }))

  const onDown = (e: React.PointerEvent) => {
    if (!enabled || e.button > 0) return
    flush()
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      on: false,
      lx: e.clientX,
      ly: e.clientY,
      lt: performance.now(),
      v: 0,
      vy: 0,
      id: e.pointerId,
    }
    if (sound) wakeAudio()
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    const vdx = props.current.rtl ? -dx : dx
    if (!d.on) {
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy)) return
      const m: Mode = vdx < 0 ? 'next' : 'prev'
      if (m === 'next' ? !props.current.canNext : !props.current.canPrev) {
        drag.current = null
        return
      }
      d.on = true
      try {
        stage.current?.setPointerCapture(e.pointerId)
      } catch {
        /* the pointer is already gone */
      }
      const r = stage.current!.getBoundingClientRect()
      begin(m, d.y - r.top > r.height / 2 ? 1 : 0)
    }
    const s = g.current
    if (!s) return
    const now = performance.now()
    const v = (e.clientX - d.lx) / Math.max(1, now - d.lt)
    const vy = (e.clientY - d.ly) / Math.max(1, now - d.lt)
    // the held page shaken: every sharp change of direction rustles it, louder the faster
    if (props.current.sound && ((v * d.v < 0 && Math.abs(v - d.v) > 0.6) || (vy * d.vy < 0 && Math.abs(vy - d.vy) > 0.6)))
      rustleSound(Math.max(Math.abs(v - d.v), Math.abs(vy - d.vy)) / 4)
    d.v = v
    d.vy = vy
    d.ly = e.clientY
    d.lx = e.clientX
    d.lt = now
    // the fold stays about under the finger
    let p = {
      x: (s.mode === 'next' ? s.w : -s.w) + vdx * 2,
      y: s.cy + dy * 0.5,
    }
    // the sheet is bound at the spine: its corner cannot go further from it than the page is wide
    const r = Math.hypot(p.x, p.y - s.cy)
    if (r > s.w) p = { x: (p.x * s.w) / r, y: s.cy + ((p.y - s.cy) * s.w) / r }
    s.p = p
    apply()
  }

  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d?.on || d.id !== e.pointerId) return
    const s = g.current
    if (!s) return
    const v = props.current.rtl ? -d.v : d.v
    const commit = s.mode === 'next' ? s.p.x < s.w * 0.35 || v < -0.45 : s.p.x > -s.w * 0.65 || v > 0.45
    const to = { x: (s.mode === 'next') === commit ? -s.w : s.w, y: s.cy }
    const left = Math.abs(to.x - s.p.x) / (2 * s.w)
    if (commit && props.current.sound) turnSound()
    animate(to, Math.max(140, DUR * left), () => finish(commit))
  }

  return (
    <div
      ref={stage}
      className={className ?? 'relative min-h-0 w-full flex-1 overflow-hidden'}
      style={{ touchAction: enabled ? 'pan-y' : undefined }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div ref={cur} className="absolute inset-0 flex flex-col" style={{ background: paper, zIndex: mode === 'prev' ? 1 : 2 }}>
        {render(0)}
      </div>
      {mode && (
        <>
          <div ref={other} className="absolute inset-0 flex flex-col" style={{ background: paper, zIndex: mode === 'prev' ? 2 : 1 }}>
            {render(mode === 'next' ? 1 : -1)}
          </div>
          <div ref={shadow} className="pointer-events-none absolute inset-0" style={{ zIndex: 3 }} />
          {/* the flap's own shadow on the page under it; WebKit redraws a filtered layer slowly, so not there */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              zIndex: 4,
              filter: isIOS ? undefined : 'drop-shadow(0 0 10px rgba(0,0,0,.35))',
            }}
          >
            <div ref={flap} className="absolute inset-0" style={{ transformOrigin: '0 0' }} />
          </div>
        </>
      )}
    </div>
  )
})

/** the part of a convex polygon on one side of the line u·q = d (`far`: the side u points to) */
function cut(poly: Pt[], u: Pt, d: number, far: boolean): Pt[] {
  const side = (p: Pt) => (u.x * p.x + u.y * p.y - d) * (far ? 1 : -1)
  const out: Pt[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[(i + poly.length - 1) % poly.length]
    const b = poly[i]
    const sa = side(a)
    const sb = side(b)
    const cross = () => {
      const t = sa / (sa - sb)
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    if (sb >= 0) {
      if (sa < 0) out.push(cross())
      out.push(b)
    } else if (sa >= 0) out.push(cross())
  }
  return out
}

const poly = (pts: Pt[]) => (pts.length < 3 ? 'polygon(0 0, 0 0, 0 0)' : `polygon(${pts.map((p) => `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`).join(',')})`)
