import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { PageCurl, type CurlHandle } from '../manga/PageCurl'
import { useManga, type BookPrefs } from '../manga/store'
import type { PAPER } from '../manga/ui'
import { turnSound, wakeAudio } from '../lib/paperSound'
import { usePowerSave } from '../lib/power'
import { justPressed } from '../manga/PageLookup'
import { FONTS, MARGINS, softFg } from './bookLook'

/**
 * A chapter set as the pages of a book: the text flows into columns exactly one page wide, each page is
 * one column, and a page is turned by sliding the flow one column along. On a wide screen two pages stand
 * side by side and the right one turns over the spine onto the left; on a narrow one a single page curls
 * like paper. Pages carry numbers and running heads, and the edges of the book thicken on the side that
 * has been read.
 */
export interface BookHandle {
  turn: (dir: 1 | -1) => void
}

type PaperColors = (typeof PAPER)[keyof typeof PAPER]

const FLIP_MS = 620
const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 300, 500, 1000]

export const BookPages = forwardRef<
  BookHandle,
  {
    html: string
    chapterTitle: string
    bookTitle: string
    prefs: BookPrefs
    paper: PaperColors
    /** changes when a new chapter opens: the position is set from `start` then */
    chapterKey: string
    /** where to open the chapter, 0…1 (1: its last page, when coming back from the next one) */
    start: number
    /** how much of the whole book lies before this chapter, and this chapter's own share, 0…1 */
    bookBefore: number
    bookShare: number
    hasNext: boolean
    hasPrev: boolean
    onNext: () => void
    onPrev: () => void
    /** the page on screen (the first of a spread) and how many pages the chapter has */
    onPage: (page: number, count: number) => void
    /** a tap in the middle of the page */
    onTap: () => void
    /** the text on screen, for reading aloud and looking words up */
    textRef: RefObject<HTMLDivElement | null>
    /** what follows the text on the chapter's last page (the next chapter's button) */
    end: ReactNode
  }
>(function BookPages(props, ref) {
  const { html, chapterTitle, bookTitle, prefs, paper, chapterKey, start, bookBefore, bookShare, hasNext, hasPrev, onNext, onPrev, onPage, onTap, textRef, end } = props
  const area = useRef<HTMLDivElement>(null)
  const flow = useRef<HTMLDivElement>(null)
  const curl = useRef<CurlHandle>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [count, setCount] = useState(1)
  const [page, setPage] = useState(0)
  const [flip, setFlip] = useState<null | { dir: 1 | -1; from: number }>(null)
  const [toast, setToast] = useState('')
  const frac = useRef(start)
  const placed = useRef('')

  // --- geometry ------------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const spread = prefs.spread ?? 'auto'
  const two = spread === 'two' ? size.w >= 640 : spread === 'one' ? false : size.w >= 900 && size.w > size.h * 1.05
  const per = two ? 2 : 1
  const desk = size.w >= 640
  // on a big screen the book lies on a desk, with a little room around it
  const deskX = desk ? Math.max(18, Math.round(size.w * 0.025)) : 0
  const deskY = desk ? 14 : 0
  const availW = size.w - 2 * deskX
  const m = MARGINS[prefs.margins ?? 'normal']
  const pageH = size.h - 2 * deskY
  const pageW = Math.floor(two ? Math.min(availW / 2, pageH * 0.8) : desk ? Math.min(availW, prefs.width + 2 * Math.max(m.min, prefs.width * m.k)) : size.w)
  const padX = Math.round(Math.max(m.min, pageW * m.k))
  const head = prefs.runningHead !== false ? 46 : 30
  const foot = 42
  const cw = Math.max(80, pageW - 2 * padX)
  const ch = Math.max(80, pageH - head - foot)
  const gap = 2 * padX
  const step = cw + gap
  const bookW = pageW * per
  const left0 = Math.round((size.w - bookW) / 2)
  const fg = prefs.softText ? softFg(paper.fg, paper.bg) : paper.fg

  // words break with hyphens by the rules of the text's language: the browser needs to be told which
  const lang = useMemo(() => ((html.slice(0, 4000).match(/[а-яё]/gi)?.length ?? 0) > 200 ? 'ru' : 'en'), [html])
  const marked = useMemo(() => (prefs.dropCap !== false ? html.replace(/<p(\s|>)/, '<p class="dropcap"$1') : html), [html, prefs.dropCap])
  // a browser without its own hyphenation dictionary (the Windows app) gets soft hyphens put in the text
  const [hy, setHy] = useState<{ src: string; out: string } | null>(null)
  useEffect(() => {
    if (canHyphenate(lang)) return
    let alive = true
    const load = lang === 'ru' ? import('hyphen/ru') : import('hyphen/en-us')
    load
      .then((mod) => mod.hyphenate(marked, { minWordLength: 6 }))
      .then((out) => alive && setHy({ src: marked, out }))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [marked, lang])
  const text = hy?.src === marked ? hy.out : marked

  const flowStyle: CSSProperties = {
    width: per * cw + (per - 1) * gap,
    height: ch,
    columnWidth: cw,
    columnGap: gap,
    columnFill: 'auto',
    fontFamily: FONTS[prefs.font]?.css ?? FONTS.literata.css,
    fontSize: prefs.size,
    lineHeight: prefs.leading,
    fontWeight: prefs.weight ?? 400,
    textAlign: prefs.justify ? 'justify' : 'left',
    color: fg,
    ['--indent' as string]: prefs.indent ? '1.5em' : '0',
    ['--para' as string]: `${prefs.para ?? 0.3}em`,
    ['--sub' as string]: paper.sub,
    ['--ch' as string]: `${ch}px`,
  }

  // --- pages ---------------------------------------------------------------------------------------
  const recount = useCallback(() => {
    const el = flow.current
    if (!el || !size.w) return
    const n = Math.max(1, Math.round((el.scrollWidth + gap) / step))
    setCount((c) => (c === n ? c : n))
  }, [gap, step, size.w])

  useLayoutEffect(() => {
    recount()
    const el = flow.current
    if (!el) return
    // pictures and the typeface arrive later and push the text on
    const later = () => recount()
    el.addEventListener('load', later, true)
    void document.fonts?.ready.then(later)
    const t = setTimeout(later, 400)
    return () => {
      el.removeEventListener('load', later, true)
      clearTimeout(t)
    }
  }, [recount, text, prefs.size, prefs.leading, prefs.font, prefs.weight, prefs.para, prefs.indent, prefs.justify, cw, ch, per])

  const snap = useCallback((p: number) => Math.max(0, Math.min(count - 1, p - (p % per))), [count, per])

  // a new chapter opens at `start`; a new layout keeps the reader at the same place in the text
  useLayoutEffect(() => {
    if (!size.w) return
    if (placed.current !== chapterKey) {
      placed.current = chapterKey
      frac.current = start
    }
    setPage(snap(Math.round(frac.current * Math.max(0, count - 1))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, per, chapterKey, size.w])

  useEffect(() => {
    // nothing to report until the chapter is laid out and placed
    if (!size.w || placed.current !== chapterKey) return
    onPage(page, count)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, count, size.w, chapterKey])

  const go = (p: number) => {
    frac.current = count > 1 ? p / (count - 1) : 0
    setPage(p)
  }

  const counted = (dir: 1 | -1) => {
    if (dir < 0) return
    const today = useManga.getState().countPage()
    if (MILESTONES.includes(today)) {
      setToast(`${today} ${plural(today)} сегодня`)
      setTimeout(() => setToast(''), 2600)
    }
  }

  // --- turning -------------------------------------------------------------------------------------
  const leaf = useRef<HTMLDivElement>(null)
  const shadeFront = useRef<HTMLDivElement>(null)
  const shadeBack = useRef<HTMLDivElement>(null)
  const castUnder = useRef<HTMLDivElement>(null)
  const anim = useRef<number>(0)
  const tNow = useRef(0)
  const drag = useRef<{ x: number; y: number; on: boolean; dir: 1 | -1; t0: number; lx: number; lt: number; v: number; id: number } | null>(null)
  const moved = useRef(false)
  // power saving: pages change at once and quietly
  const power = usePowerSave()
  const animate = prefs.curl !== false && !power
  const sound = prefs.flipSound !== false && !power

  const paint = useCallback((t: number) => {
    tNow.current = t
    const l = leaf.current
    if (!l || !flip) return
    l.style.transform = `rotateY(${flip.dir > 0 ? -180 * t : 180 * t}deg)`
    if (shadeFront.current) shadeFront.current.style.opacity = String(Math.min(1, t * 2) * 0.55)
    if (shadeBack.current) shadeBack.current.style.opacity = String(Math.max(0, 1 - (t - 0.5) * 2) * 0.55)
    if (castUnder.current) castUnder.current.style.opacity = String(Math.sin(Math.PI * Math.min(1, t * 1.3)) * 0.6)
  }, [flip])

  useLayoutEffect(() => {
    if (flip) paint(tNow.current)
  }, [flip, paint])

  const finishFlip = (commit: boolean) => {
    const f = flip
    cancelAnimationFrame(anim.current)
    setFlip(null)
    tNow.current = 0
    if (f && commit) {
      go(f.from + 2 * f.dir)
      counted(f.dir)
    }
  }

  const run = (to: number, ms: number, done: () => void) => {
    const from = tNow.current
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
      paint(from + (to - from) * e)
      if (k < 1) anim.current = requestAnimationFrame(tick)
      else done()
    }
    anim.current = requestAnimationFrame(tick)
  }

  // the turn started by a tap or a key plays out once the flipping sheet is on the page
  const auto = useRef(false)
  useEffect(() => {
    if (!flip || !auto.current) return
    auto.current = false
    run(1, FLIP_MS, () => finishFlip(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flip])

  const turn = (dir: 1 | -1) => {
    if (flip) {
      cancelAnimationFrame(anim.current)
      finishFlip(true)
      return
    }
    const to = page + dir * per
    if (to >= count) return hasNext && onNext()
    if (to < 0) return hasPrev && onPrev()
    if (!two) {
      if (animate && curl.current?.turn(dir)) return
      if (sound) turnSound()
      go(to)
      counted(dir)
      return
    }
    if (sound) turnSound()
    if (!animate) {
      go(to)
      counted(dir)
      return
    }
    auto.current = true
    tNow.current = 0
    setFlip({ dir, from: page })
  }

  useImperativeHandle(ref, () => ({ turn }))

  // a spread's page dragged over the spine by its edge
  const spine = left0 + pageW
  const downAt = useRef({ x: 0, y: 0 })
  const onDown = (e: React.PointerEvent) => {
    moved.current = false
    downAt.current = { x: e.clientX, y: e.clientY }
    if (e.button > 0) return
    if (sound) wakeAudio()
    if (!two || !animate || flip) return
    const r = area.current!.getBoundingClientRect()
    const x = e.clientX - r.left
    const dir: 1 | -1 = x > spine ? 1 : -1
    drag.current = { x: e.clientX, y: e.clientY, on: false, dir, t0: 0, lx: e.clientX, lt: performance.now(), v: 0, id: e.pointerId }
  }
  const tFor = (clientX: number, dir: 1 | -1) => {
    const r = area.current!.getBoundingClientRect()
    const x = clientX - r.left
    const c = Math.max(-1, Math.min(1, dir > 0 ? (x - spine) / pageW : (spine - x) / pageW))
    return Math.acos(c) / Math.PI
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (e.buttons && Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) > 10) moved.current = true
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    if (!d.on) {
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return
      if (window.getSelection()?.toString()) return (drag.current = null)
      const to = page + d.dir * 2
      if ((d.dir > 0 && dx > 0) || (d.dir < 0 && dx < 0) || to < 0 || to >= count) return (drag.current = null)
      d.on = true
      d.t0 = tFor(d.x, d.dir)
      try {
        area.current?.setPointerCapture(e.pointerId)
      } catch {
        /* gone */
      }
      tNow.current = 0
      setFlip({ dir: d.dir, from: page })
    }
    const now = performance.now()
    d.v = (e.clientX - d.lx) / Math.max(1, now - d.lt)
    d.lx = e.clientX
    d.lt = now
    paint(Math.max(0, Math.min(1, tFor(e.clientX, d.dir) - d.t0)))
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d?.on || d.id !== e.pointerId) return
    const v = d.dir > 0 ? -d.v : d.v
    const commit = tNow.current > 0.45 || v > 0.4
    if (commit && sound) turnSound()
    run(commit ? 1 : 0, Math.max(160, FLIP_MS * (commit ? 1 - tNow.current : tNow.current)), () => finishFlip(commit))
  }

  // taps: the outer thirds turn, the middle shows the controls
  const onClick = (e: React.MouseEvent) => {
    if (moved.current || justPressed()) return
    if ((e.target as HTMLElement).closest('button, a')) return
    if (window.getSelection()?.toString()) return
    const x = e.clientX / window.innerWidth
    if (x < 0.3) turn(-1)
    else if (x > 0.7) turn(1)
    else onTap()
  }

  // a touchpad sends a stream of wheel events for one swipe: one turn per swipe
  const lastWheel = useRef(0)
  const onWheel = (e: React.WheelEvent) => {
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    if (Math.abs(d) < 20 || Date.now() - lastWheel.current < 450) return
    lastWheel.current = Date.now()
    turn(d > 0 ? 1 : -1)
  }

  // reading aloud: the paragraph being read is kept on the screen, and lit on every copy of the text
  useEffect(() => {
    const live = textRef.current
    if (!live) return
    const mo = new MutationObserver(() => {
      const el = live.querySelector('.narrating') as HTMLElement | null
      const f = flow.current
      if (!el || !f) return
      const dx = el.getBoundingClientRect().left - f.getBoundingClientRect().left
      const col = Math.floor((dx + gap / 2) / step)
      if (col < page || col >= page + per) go(snap(col))
    })
    mo.observe(live, { subtree: true, attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textRef, page, per, step, gap, count])

  // --- drawing -------------------------------------------------------------------------------------
  /** the content of the flow, the same in every copy */
  const content = (live: boolean) => (
    <>
      <header className="book-opening" style={{ paddingTop: Math.round(ch * 0.14) }}>
        <div className="book-opening-title">{chapterTitle}</div>
        <div className="book-opening-rule" style={{ background: paper.sub }} />
      </header>
      <div ref={live ? textRef : undefined} dangerouslySetInnerHTML={{ __html: text }} />
      <div className="book-end" style={{ color: paper.sub }}>
        <div className="book-end-mark">❦</div>
        {end}
      </div>
    </>
  )

  /** one page of the chapter, a copy for the turn; its text is the same flow, slid to the page */
  const copy = (p: number) => (
    <div className="absolute overflow-hidden" style={{ left: padX, top: head, width: cw, height: ch }}>
      <div lang={lang} className="book book-flow" style={{ ...flowStyle, width: cw, transform: `translateX(${-p * step}px)` }}>
        {content(false)}
      </div>
    </div>
  )

  /** a sheet of paper: running head, page number, the shade of the spine */
  const frame = (p: number, side: 'left' | 'right' | 'single', withText: boolean) => (
    <div className="absolute inset-0 overflow-hidden" style={{ background: paper.bg }}>
      {side !== 'single' && (
        <div
          className="pointer-events-none absolute inset-y-0"
          style={{
            [side === 'left' ? 'right' : 'left']: 0,
            width: Math.round(pageW * 0.14),
            background: `linear-gradient(${side === 'left' ? 'to left' : 'to right'}, rgba(0,0,0,${paper.dark ? 0.45 : 0.2}), rgba(0,0,0,${paper.dark ? 0.12 : 0.05}) 35%, transparent)`,
          }}
        />
      )}
      {side === 'single' && desk && <div className="pointer-events-none absolute inset-y-0 left-0 w-6" style={{ background: `linear-gradient(to right, rgba(0,0,0,${paper.dark ? 0.35 : 0.12}), transparent)` }} />}
      {p < count && prefs.runningHead !== false && p > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-end justify-center overflow-hidden px-10" style={{ height: head - 12, color: paper.sub }}>
          <span className="truncate text-[11px] font-semibold tracking-[0.18em] uppercase" style={{ fontFamily: FONTS[prefs.font]?.css }}>
            {two && side === 'left' ? bookTitle : chapterTitle}
          </span>
        </div>
      )}
      {p < count && (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-start px-8 pt-2.5 text-[13px] tabular-nums ${side === 'left' ? 'justify-start' : side === 'right' ? 'justify-end' : 'justify-center'}`}
          style={{ height: foot, color: paper.sub, fontFamily: FONTS[prefs.font]?.css }}
        >
          {p + 1}
        </div>
      )}
      {withText && p < count && copy(p)}
    </div>
  )

  const readFrac = Math.min(1, bookBefore + bookShare * (count > 1 ? page / (count - 1) : 0))
  const stack = (w: number, sideLeft: boolean): CSSProperties => ({
    position: 'absolute',
    top: 3,
    bottom: 3,
    [sideLeft ? 'right' : 'left']: '100%',
    width: w,
    background: `repeating-linear-gradient(90deg, ${paper.bg} 0 1px, color-mix(in srgb, ${paper.bg} ${paper.dark ? 70 : 82}%, #000) 1px 2px)`,
    borderRadius: sideLeft ? '3px 0 0 3px' : '0 3px 3px 0',
    boxShadow: '0 6px 18px rgba(0,0,0,.35)',
  })

  const deskBg = paper.dark ? `color-mix(in srgb, ${paper.bg} 70%, #000)` : `color-mix(in srgb, ${paper.bg} 62%, #2a2118)`

  const live = (
    <div className="absolute overflow-hidden" style={{ left: padX, top: head, width: per * cw + (per - 1) * gap, height: ch }} onScroll={(e) => ((e.currentTarget.scrollLeft = 0), (e.currentTarget.scrollTop = 0))}>
      <div ref={flow} lang={lang} className="book book-flow" style={{ ...flowStyle, transform: `translateX(${-page * step}px)` }}>
        {content(true)}
      </div>
    </div>
  )

  return (
    <div
      ref={area}
      className="relative min-h-0 flex-1 overflow-hidden select-text"
      style={{ background: desk ? deskBg : paper.bg, touchAction: 'pan-y' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClick={onClick}
      onWheel={onWheel}
    >
      {size.w > 0 && (
        <div className="absolute" style={{ top: deskY, bottom: deskY, left: left0, width: bookW, perspective: two ? 2600 : undefined, boxShadow: desk ? '0 24px 70px rgba(0,0,0,.5)' : undefined }}>
          {desk && (
            <>
              <div style={stack(2 + Math.round(10 * readFrac), true)} />
              <div style={stack(2 + Math.round(10 * (1 - readFrac)), false)} />
            </>
          )}
          {two ? (
            <>
              <div className="absolute inset-y-0 left-0" style={{ width: pageW }}>
                {frame(page, 'left', false)}
              </div>
              <div className="absolute inset-y-0" style={{ left: pageW, width: pageW }}>
                {frame(page + 1, 'right', false)}
              </div>
              {live}
              {flip && (
                <>
                  {/* the page uncovered under the turning one */}
                  <div className="absolute inset-y-0" style={{ left: flip.dir > 0 ? pageW : 0, width: pageW }}>
                    {frame(flip.dir > 0 ? flip.from + 3 : flip.from - 2, flip.dir > 0 ? 'right' : 'left', true)}
                    <div
                      ref={castUnder}
                      className="pointer-events-none absolute inset-0"
                      style={{ opacity: 0, background: `linear-gradient(${flip.dir > 0 ? 'to right' : 'to left'}, rgba(0,0,0,.55), rgba(0,0,0,.15) 45%, transparent 80%)` }}
                    />
                  </div>
                  <div
                    ref={leaf}
                    className="absolute inset-y-0"
                    style={{ left: flip.dir > 0 ? pageW : 0, width: pageW, transformStyle: 'preserve-3d', transformOrigin: flip.dir > 0 ? 'left center' : 'right center', zIndex: 3 }}
                  >
                    <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
                      {frame(flip.from + (flip.dir > 0 ? 1 : 0), flip.dir > 0 ? 'right' : 'left', true)}
                      <div
                        ref={shadeFront}
                        className="pointer-events-none absolute inset-0"
                        style={{ opacity: 0, background: `linear-gradient(${flip.dir > 0 ? 'to right' : 'to left'}, rgba(0,0,0,.5), rgba(0,0,0,.08) 50%, rgba(0,0,0,.3))` }}
                      />
                    </div>
                    <div className="absolute inset-0" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
                      {frame(flip.dir > 0 ? flip.from + 2 : flip.from - 1, flip.dir > 0 ? 'left' : 'right', true)}
                      <div
                        ref={shadeBack}
                        className="pointer-events-none absolute inset-0"
                        style={{ opacity: 0.55, background: `linear-gradient(${flip.dir > 0 ? 'to left' : 'to right'}, rgba(0,0,0,.45), rgba(0,0,0,.05) 45%, rgba(255,255,255,.06))` }}
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <PageCurl
              ref={curl}
              enabled={animate}
              sound={sound}
              paper={paper.bg}
              canNext={page + 1 < count}
              canPrev={page > 0}
              onNext={() => (go(page + 1), counted(1))}
              onPrev={() => go(page - 1)}
              className="absolute inset-0 overflow-hidden"
              render={(at) =>
                at === 0 ? (
                  <>
                    {frame(page, 'single', false)}
                    {live}
                  </>
                ) : (
                  frame(page + at, 'single', true)
                )
              }
            />
          )}
        </div>
      )}
      {toast && (
        <div className="animate-pop pointer-events-none absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-black/75 px-7 py-5 text-center text-white shadow-2xl backdrop-blur">
          <div className="text-3xl font-black">{toast.split(' ')[0]}</div>
          <div className="text-sm font-bold text-white/75">{toast.split(' ').slice(1).join(' ')}</div>
        </div>
      )}
    </div>
  )
})

const hyphenates: Record<string, boolean> = {}
/** whether the browser breaks words with hyphens in this language by itself */
function canHyphenate(lang: string) {
  if (lang in hyphenates) return hyphenates[lang]
  const el = document.createElement('div')
  el.lang = lang
  el.style.cssText = 'position:absolute;visibility:hidden;width:60px;font-size:16px;-webkit-hyphens:auto;hyphens:auto;line-height:20px'
  el.textContent = lang === 'ru' ? 'электрификация' : 'internationalization'
  document.body.appendChild(el)
  const auto = el.offsetHeight
  el.style.setProperty('hyphens', 'manual')
  el.style.setProperty('-webkit-hyphens', 'manual')
  const manual = el.offsetHeight
  el.remove()
  return (hyphenates[lang] = auto > manual)
}

function plural(n: number) {
  const a = n % 10
  const b = n % 100
  if (a === 1 && b !== 11) return 'страница'
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'страницы'
  return 'страниц'
}
