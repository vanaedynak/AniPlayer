import { createContext, useEffect, useRef, useState } from 'react'
import { Copy, Loader2, Volume2, X, KeyRound } from 'lucide-react'
import { savedTranslation, translatePage, DEFAULT_MODEL, type Bubble } from './translate'
import { lookup, say, type LookupResult } from './SelectionTranslate'

/**
 * Hold a finger on a line of a manga page and its translation comes up: the words on a page are part of
 * the picture, so nothing can be selected there the way text in a ranobe is. The page is read once by
 * Gemini (the same reading the page translator does, remembered on the device), the bubble under the finger
 * is picked out, and each of its words can be tapped for its own meaning.
 */
export interface PressAt {
  /** the page's index and its address (the one translations are remembered by) */
  i: number
  url: string
  alt?: string
  /** the point on the page, as fractions of its width and height */
  fx: number
  fy: number
  /** where the picture stood on the screen at the time */
  rect: { left: number; top: number; width: number; height: number }
}

/** set by the reader when looking words up works there; pages call it on a long press */
export const PressCtx = createContext<((p: PressAt) => void) | null>(null)

/** the time of the last long press: the tap that ends it must not also turn the page or show the controls */
export const pressed = { at: 0 }
export const justPressed = () => Date.now() - pressed.at < 700

/** a long press on an element: fires after `ms` if the finger stayed put; returns the handlers to spread on it */
export function longPress(fire: (e: { clientX: number; clientY: number }) => void, ms = 480) {
  let t: ReturnType<typeof setTimeout> | undefined
  let at: { x: number; y: number; id: number } | null = null
  const stop = () => {
    clearTimeout(t)
    at = null
  }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button > 0) return
      stop()
      at = { x: e.clientX, y: e.clientY, id: e.pointerId }
      const p = { clientX: e.clientX, clientY: e.clientY }
      t = setTimeout(() => {
        pressed.at = Date.now()
        navigator.vibrate?.(12)
        fire(p)
        at = null
      }, ms)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (at && at.id === e.pointerId && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 10) stop()
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    // no "save picture" menu on the iPad, no context menu on the PC
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }
}

/** the bubble under (or nearest to) the point, if any is close enough */
function bubbleAt(list: Bubble[], fx: number, fy: number) {
  const pad = 0.02
  const inside = list.filter((b) => fx >= b.x - pad && fx <= b.x + b.w + pad && fy >= b.y - pad && fy <= b.y + b.h + pad)
  if (inside.length) return inside.reduce((a, b) => (a.w * a.h <= b.w * b.h ? a : b))
  let best: Bubble | null = null
  let dist = 0.09
  for (const b of list) {
    const dx = Math.max(b.x - fx, 0, fx - b.x - b.w)
    const dy = Math.max(b.y - fy, 0, fy - b.y - b.h)
    const d = Math.hypot(dx, dy)
    if (d < dist) (best = b), (dist = d)
  }
  return best
}

export function PageLookup({
  at,
  close,
  title,
  keys,
  model,
  glossary,
  onSetup,
}: {
  at: PressAt
  close: () => void
  title: string
  keys: string[]
  model: string
  glossary?: string
  onSetup: () => void
}) {
  const hasKey = keys.some((k) => k.trim())
  const [list, setList] = useState<Bubble[] | null>(() => savedTranslation(at.url))
  const [err, setErr] = useState('')
  const [word, setWord] = useState<string | null>(null)
  const [wordRes, setWordRes] = useState<LookupResult | null>(null)
  const [wordErr, setWordErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(0)

  useEffect(() => {
    setWord(null)
    const hit = savedTranslation(at.url)
    setList(hit)
    setErr('')
    if (hit || !hasKey) return
    let alive = true
    translatePage(at.url, { keys, model: model || DEFAULT_MODEL, title, glossary, alt: at.alt })
      .then((b) => alive && setList(b))
      .catch((e) => alive && setErr(String(e?.message ?? e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.url, hasKey])

  const b = list ? bubbleAt(list, at.fx, at.fy) : null

  useEffect(() => {
    if (!word || !b) return
    let alive = true
    setWordRes(null)
    setWordErr('')
    lookup(word, b.text, title, keys, model)
      .then((r) => alive && setWordRes(r))
      .catch((e) => alive && setWordErr(String(e?.message ?? e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, b?.text])

  useEffect(() => {
    if (box.current) setH(box.current.offsetHeight)
  })

  // the bubble's box on the screen, highlighted under the card
  const r = at.rect
  const hl = b ? { left: r.left + b.x * r.width, top: r.top + b.y * r.height, width: b.w * r.width, height: b.h * r.height } : null
  const px = r.left + at.fx * r.width
  const py = r.top + at.fy * r.height
  const anchorTop = hl ? hl.top : py
  const anchorBottom = hl ? hl.top + hl.height : py
  const w = Math.min(380, window.innerWidth - 24)
  const left = Math.max(12, Math.min(window.innerWidth - w - 12, (hl ? hl.left + hl.width / 2 : px) - w / 2))
  const below = anchorBottom + 12 + (h || 180) < window.innerHeight - 16
  const top = below ? anchorBottom + 12 : Math.max(12, anchorTop - 12 - (h || 180))
  const words = b ? b.text.split(/(\s+)/) : []

  return (
    <>
      <div className="fixed inset-0 z-[79]" onPointerDown={(e) => (e.stopPropagation(), close())} />
      {hl ? (
        <div className="pointer-events-none fixed z-[79] rounded-xl ring-2 ring-accent-2 transition-all" style={{ ...hl, boxShadow: '0 0 0 9999px rgba(0,0,0,.35)' }} />
      ) : (
        <div className="pointer-events-none fixed z-[79] h-10 w-10 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-accent-2/50" style={{ left: px, top: py }} />
      )}
      <div
        ref={box}
        className="animate-pop fixed z-[80] flex flex-col gap-2.5 rounded-2xl bg-card/95 p-4 text-left text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
        style={{ left, top, width: w, fontFamily: '"Manrope Variable", system-ui, sans-serif' }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {!hasKey ? (
          <div className="flex flex-col gap-3">
            <div className="text-sm leading-relaxed text-white/80">
              Текст на странице манги — часть картинки. Чтобы прочитать фразу под пальцем и перевести её, нужен бесплатный ключ Gemini.
            </div>
            <button onClick={onSetup} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-bold">
              <KeyRound size={16} /> Добавить ключ
            </button>
          </div>
        ) : err ? (
          <div className="text-sm text-rose-300">Не получилось прочитать страницу: {err}</div>
        ) : !list ? (
          <div className="flex items-center gap-2 text-sm text-white/70">
            <Loader2 size={15} className="animate-spin" /> Читаю текст на странице…
          </div>
        ) : !b ? (
          <div className="text-sm text-white/70">Здесь нет текста. Зажмите палец прямо на реплике.</div>
        ) : (
          <>
            <div className="flex items-start gap-1">
              <div className="min-w-0 flex-1 text-[15px] leading-relaxed font-bold">
                {words.map((t, k) =>
                  /^\s+$/.test(t) || !/[\p{L}\p{N}]/u.test(t) ? (
                    <span key={k}>{t}</span>
                  ) : (
                    <button
                      key={k}
                      onClick={() => setWord(t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))}
                      className={
                        word === t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
                          ? 'rounded bg-accent-2/30 text-accent-2'
                          : 'rounded underline decoration-white/25 decoration-dotted underline-offset-4 hover:bg-white/10'
                      }
                    >
                      {t}
                    </button>
                  ),
                )}
              </div>
              <button onClick={() => say(word || b.text)} title="Произнести" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
                <Volume2 size={16} />
              </button>
              <button onClick={() => void navigator.clipboard?.writeText(`${b.text} — ${b.ru}`).catch(() => {})} title="Скопировать" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
                <Copy size={15} />
              </button>
              <button onClick={close} title="Закрыть" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
                <X size={16} />
              </button>
            </div>
            <div className="text-base leading-snug font-extrabold">{b.ru}</div>
            {word ? (
              <div className="rounded-xl bg-white/5 px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-extrabold text-accent-2">{word}</span>
                  {wordRes?.transcription && <span className="text-xs text-white/45">[{wordRes.transcription.replace(/^\[|\]$|^\/|\/$/g, '')}]</span>}
                  {wordRes?.pos && <span className="text-xs text-white/45 italic">{wordRes.pos}</span>}
                </div>
                {wordErr ? (
                  <div className="text-sm text-rose-300">{wordErr}</div>
                ) : !wordRes ? (
                  <div className="mt-1 flex items-center gap-2 text-sm text-white/60">
                    <Loader2 size={14} className="animate-spin" /> Смотрю значение…
                  </div>
                ) : (
                  <>
                    <div className="mt-0.5 text-[15px] font-bold">{wordRes.translation}</div>
                    {!!wordRes.meanings?.length && <div className="text-sm text-white/65">{wordRes.meanings.filter((m) => m && m !== wordRes.translation).join(', ')}</div>}
                    {wordRes.note && <div className="mt-1 text-xs leading-relaxed text-white/60">{wordRes.note}</div>}
                  </>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-white/40">Нажмите на слово — покажу его перевод и произношение</div>
            )}
          </>
        )}
      </div>
    </>
  )
}
