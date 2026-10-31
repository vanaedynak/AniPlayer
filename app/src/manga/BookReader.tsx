import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, List, Type, Maximize, Minimize, Loader2, AlertCircle } from 'lucide-react'
import { openBook, useBooks, type Parsed } from './books'
import { useManga, type BookPrefs } from './store'
import { PAPER } from './ui'
import { Sheet, Field, Seg, Toggle, IconBtn } from './Reader'
import { cn } from '../lib/format'

type Doc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
type El = HTMLElement & { webkitRequestFullscreen?: () => void }

const FONTS = {
  serif: { css: 'Georgia, "PT Serif", "Times New Roman", serif', label: 'С засечками' },
  sans: { css: '"Manrope Variable", system-ui, sans-serif', label: 'Без засечек' },
  mono: { css: 'ui-monospace, "Cascadia Mono", Consolas, monospace', label: 'Моно' },
}

export default function BookReader() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const book = useBooks((s) => s.books[id])
  const position = useBooks((s) => s.position)
  const prefs = useManga((s) => s.book)
  const setBook = useManga((s) => s.setBook)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [error, setError] = useState('')
  const [chapter, setChapter] = useState(book?.chapter ?? 0)
  const [ui, setUi] = useState(true)
  const [panel, setPanel] = useState<null | 'toc' | 'type'>(null)
  const [full, setFull] = useState(false)
  const [frac, setFrac] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const restore = useRef(book?.frac ?? 0)
  const lastY = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const paper = PAPER[prefs.paper]

  useEffect(() => {
    if (!book) return
    openBook(book)
      .then(setParsed)
      .catch((e) => setError(String(e?.message ?? e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // back to the saved spot once the chapter is laid out; new chapters start at the top
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !parsed) return
    el.scrollTop = restore.current * (el.scrollHeight - el.clientHeight)
    restore.current = 0
  }, [chapter, parsed])

  useEffect(() => {
    const d = document as Doc
    const on = () => setFull(!!(d.fullscreenElement || d.webkitFullscreenElement))
    document.addEventListener('fullscreenchange', on)
    document.addEventListener('webkitfullscreenchange', on)
    return () => {
      document.removeEventListener('fullscreenchange', on)
      document.removeEventListener('webkitfullscreenchange', on)
    }
  }, [])

  const count = parsed?.chapters.length ?? 0
  const goChapter = (i: number) => {
    if (i < 0 || i >= count) return
    setChapter(i)
    setFrac(0)
    position(id, i, 0)
    scroller.current?.scrollTo({ top: 0 })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return panel ? setPanel(null) : nav('/ranobe')
      if (e.key === 'ArrowRight') goChapter(chapter + 1)
      if (e.key === 'ArrowLeft') goChapter(chapter - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!book)
    return (
      <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-bg">
        <div className="font-bold">Книга не найдена на этом устройстве</div>
        <button onClick={() => nav('/ranobe')} className="rounded-full bg-white/10 px-6 py-3 font-bold">
          К книгам
        </button>
      </div>
    )

  const ch = parsed?.chapters[Math.min(chapter, count - 1)]
  const total = count ? Math.round(((chapter + frac) / count) * 100) : 0
  const toggleFull = () => {
    const d = document as Doc
    const el = document.documentElement as El
    if (d.fullscreenElement || d.webkitFullscreenElement) void (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())
    else void (el.requestFullscreen?.().catch(() => {}) ?? el.webkitRequestFullscreen?.())
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col" style={{ background: paper.bg, color: paper.fg }}>
      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <AlertCircle size={32} className="text-rose-400" />
          <div className="font-bold">Не удалось открыть книгу</div>
          <div className="text-sm opacity-70">{error}</div>
        </div>
      ) : !ch ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={34} className="animate-spin opacity-60" />
        </div>
      ) : (
        <div
          ref={scroller}
          className="flex-1 overflow-y-auto overscroll-contain"
          onScroll={(e) => {
            const el = e.currentTarget
            const f = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 1
            setFrac(f)
            clearTimeout(saveTimer.current)
            saveTimer.current = setTimeout(() => position(id, chapter, f), 600)
            if (el.scrollTop > lastY.current + 40) setUi(false)
            lastY.current = el.scrollTop
          }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button, a')) return
            if (window.getSelection()?.toString()) return
            setUi((v) => !v)
          }}
        >
          <article
            className="book mx-auto px-5 sm:px-8"
            style={{
              maxWidth: prefs.width,
              fontFamily: FONTS[prefs.font].css,
              fontSize: prefs.size,
              lineHeight: prefs.leading,
              textAlign: prefs.justify ? 'justify' : 'left',
              paddingTop: 'calc(var(--safe-top) + 84px)',
              paddingBottom: 'calc(var(--safe-bottom) + 40px)',
              ['--indent' as string]: prefs.indent ? '1.5em' : '0',
              ['--sub' as string]: paper.sub,
            }}
          >
            <div className="mb-8 text-center text-sm font-bold tracking-wide uppercase" style={{ color: paper.sub, fontFamily: FONTS.sans.css }}>
              {ch.title}
            </div>
            <div dangerouslySetInnerHTML={{ __html: ch.html }} />
            <div className="mt-14 flex flex-col items-center gap-3" style={{ fontFamily: FONTS.sans.css }}>
              {chapter < count - 1 ? (
                <button onClick={() => goChapter(chapter + 1)} className="flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 font-bold text-white shadow-xl">
                  Следующая глава <ChevronRight size={18} />
                </button>
              ) : (
                <div className="text-sm font-bold" style={{ color: paper.sub }}>
                  Конец книги
                </div>
              )}
            </div>
          </article>
        </div>
      )}

      <div
        className={cn('absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/80 to-black/0 px-3 pb-8 text-white transition duration-300 sm:px-5', !ui && !panel && '-translate-y-full opacity-0')}
        style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}
      >
        <IconBtn onClick={() => nav('/ranobe')} title="К книгам">
          <ArrowLeft size={22} />
        </IconBtn>
        <div className="min-w-0 flex-1">
          <div className="truncate font-extrabold">{book.title}</div>
          <div className="truncate text-xs font-semibold text-white/70">
            {ch?.title} · {total}%
          </div>
        </div>
        <IconBtn onClick={() => setPanel(panel === 'toc' ? null : 'toc')} title="Оглавление">
          <List size={20} />
        </IconBtn>
        <IconBtn onClick={() => setPanel(panel === 'type' ? null : 'type')} title="Шрифт и тема">
          <Type size={20} />
        </IconBtn>
        <IconBtn onClick={toggleFull} title="Во весь экран">
          {full ? <Minimize size={20} /> : <Maximize size={20} />}
        </IconBtn>
      </div>

      <div
        className={cn('absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 bg-gradient-to-t from-black/80 to-black/0 px-3 pt-10 text-white transition duration-300 sm:px-5', !ui && !panel && 'translate-y-full opacity-0')}
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
      >
        <IconBtn onClick={() => goChapter(chapter - 1)} disabled={chapter <= 0} title="Предыдущая глава">
          <ChevronLeft size={22} />
        </IconBtn>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-accent-2" style={{ width: `${total}%` }} />
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums">
          {Math.min(chapter + 1, count)} / {count}
        </span>
        <IconBtn onClick={() => goChapter(chapter + 1)} disabled={chapter >= count - 1} title="Следующая глава">
          <ChevronRight size={22} />
        </IconBtn>
      </div>

      {panel && <div className="absolute inset-0 z-20 bg-black/40" onClick={() => setPanel(null)} />}
      {panel === 'toc' && parsed && (
        <Sheet title="Оглавление" close={() => setPanel(null)}>
          <div className="flex flex-col gap-1">
            {parsed.chapters.map((c, i) => (
              <button
                key={i}
                ref={i === chapter ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
                onClick={() => (setPanel(null), goChapter(i))}
                className={cn('rounded-xl px-3 py-2.5 text-left text-sm font-bold hover:bg-white/10', i === chapter && 'bg-accent/25 ring-1 ring-accent/50', i < chapter && 'text-white/45')}
              >
                {c.title}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {panel === 'type' && <TypeSheet prefs={prefs} set={setBook} close={() => setPanel(null)} />}
    </div>
  )
}

function TypeSheet({ prefs, set, close }: { prefs: BookPrefs; set: (p: Partial<BookPrefs>) => void; close: () => void }) {
  return (
    <Sheet title="Шрифт и тема" close={close}>
      <div className="flex flex-col gap-6">
        <Field label={`Размер шрифта · ${prefs.size}px`}>
          <div className="flex items-center gap-3">
            <button onClick={() => set({ size: Math.max(13, prefs.size - 1) })} className="h-10 w-10 rounded-full bg-white/10 text-sm font-extrabold">
              A−
            </button>
            <input type="range" min={13} max={32} value={prefs.size} onChange={(e) => set({ size: Number(e.target.value) })} className="flex-1 accent-[#a78bfa]" />
            <button onClick={() => set({ size: Math.min(32, prefs.size + 1) })} className="h-10 w-10 rounded-full bg-white/10 text-lg font-extrabold">
              A+
            </button>
          </div>
        </Field>
        <Field label="Шрифт">
          <Seg value={prefs.font} onChange={(font) => set({ font })} options={(Object.keys(FONTS) as BookPrefs['font'][]).map((k) => ({ v: k, l: FONTS[k].label }))} />
        </Field>
        <Field label={`Межстрочный интервал · ${prefs.leading.toFixed(1)}`}>
          <input type="range" min={1.2} max={2.2} step={0.1} value={prefs.leading} onChange={(e) => set({ leading: Number(e.target.value) })} className="w-full accent-[#a78bfa]" />
        </Field>
        <Field label={`Ширина текста · ${prefs.width}px`}>
          <input type="range" min={480} max={1200} step={20} value={prefs.width} onChange={(e) => set({ width: Number(e.target.value) })} className="w-full accent-[#a78bfa]" />
        </Field>
        <Field label="Тема">
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(PAPER) as (keyof typeof PAPER)[]).map((k) => (
              <button
                key={k}
                onClick={() => set({ paper: k })}
                className={cn('flex flex-col items-center gap-1.5 rounded-xl p-2 text-xs font-bold ring-1', prefs.paper === k ? 'ring-accent-2' : 'ring-white/10 hover:ring-white/30')}
              >
                <span className="flex h-9 w-full items-center justify-center rounded-lg font-serif text-base ring-1 ring-white/10" style={{ background: PAPER[k].bg, color: PAPER[k].fg }}>
                  Аа
                </span>
                {PAPER[k].label}
              </button>
            ))}
          </div>
        </Field>
        <Toggle label="Выравнивание по ширине" value={prefs.justify} onChange={(justify) => set({ justify })} />
        <Toggle label="Красная строка" value={prefs.indent} onChange={(indent) => set({ indent })} />
      </div>
    </Sheet>
  )
}
