import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, List, Settings2, Maximize, Minimize, Loader2, X, Check, ExternalLink, AlertCircle } from 'lucide-react'
import { manga, pages, chapterKey, chapterLabel, mangaName, type Chapter, type Manga } from './md'
import { useManga, type ReaderPrefs } from './store'
import { useChapters, pickLang } from './useChapters'
import { PAPER } from './ui'
import { useAsync } from '../lib/useAsync'
import { cn } from '../lib/format'

type Doc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
type El = HTMLElement & { webkitRequestFullscreen?: () => void }

export default function MangaReader() {
  const { id = '', chapterId = '' } = useParams()
  const nav = useNavigate()
  const m = useAsync(() => manga(id), [id])
  const entryLang = useManga((s) => s.entries[id]?.lang)
  const preferred = useManga((s) => s.prefs.lang)
  const lang = m.data ? pickLang(m.data.langs, entryLang, preferred) : null
  const { list, all } = useChapters(id, lang)
  const chapter = all.find((c) => c.id === chapterId) ?? null

  // the shelf entry has to exist before progress can be saved
  useEffect(() => {
    if (m.data && !useManga.getState().entries[id]) useManga.getState().touch(m.data, {})
  }, [m.data, id])

  const exit = () => nav(`/manga/${id}`)
  return (
    <ReaderView
      key={chapterId}
      mangaId={id}
      m={m.data}
      chapterId={chapterId}
      chapter={chapter}
      list={list}
      onExit={exit}
      onChapter={(c) => nav(`/manga/read/${id}/${c.id}`, { replace: true })}
    />
  )
}

function ReaderView({
  mangaId,
  m,
  chapterId,
  chapter,
  list,
  onExit,
  onChapter,
}: {
  mangaId: string
  m: Manga | null
  chapterId: string
  chapter: Chapter | null
  list: Chapter[]
  onExit: () => void
  onChapter: (c: Chapter) => void
}) {
  const prefs = useManga((s) => s.prefs)
  const setPrefs = useManga((s) => s.setPrefs)
  const resume = useManga.getState().entries[mangaId]
  const startPage = resume?.lastChapterId === chapterId && resume.lastPage && resume.lastPage < (resume.lastPages ?? 0) - 1 ? resume.lastPage : 0
  const src = useAsync(() => pages(chapterId, prefs.saver), [chapterId, prefs.saver])
  const urls = src.data?.urls ?? []
  const n = urls.length
  const [page, setPage] = useState(startPage)
  const [ui, setUi] = useState(true)
  const [panel, setPanel] = useState<null | 'settings' | 'chapters'>(null)
  const [failed, setFailed] = useState<Record<number, number>>({})
  const [full, setFull] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const paper = PAPER[prefs.paper]

  // neighbours in reading order (the chapter may be another group's version of the same number)
  const idx = chapter ? list.findIndex((c) => chapterKey(c) === chapterKey(chapter)) : -1
  const prev = idx > 0 ? list[idx - 1] : null
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null
  const label = chapter ? chapterLabel(chapter) : ''

  const paged = prefs.mode !== 'scroll'
  const rtl = prefs.mode === 'rtl'
  const wide = typeof window !== 'undefined' && window.innerWidth > window.innerHeight && window.innerWidth >= 900
  const spread = paged && prefs.spread && wide
  const step = spread ? 2 : 1
  // the extra slot after the last page is the "chapter finished" screen
  const last = n

  // progress: saved on every page, the chapter counts as read on its last page
  useEffect(() => {
    if (!n || !chapter) return
    const shown = Math.min(page, n - 1)
    useManga.getState().progress(mangaId, {
      chapterId,
      label,
      page: shown,
      pages: n,
      key: chapterKey(chapter),
      done: page >= n - 1,
    })
  }, [page, n, chapter, chapterId, mangaId, label])

  // warm up the next chapter's page list near the end
  useEffect(() => {
    if (next && !next.external && n && page >= n - 3) void pages(next.id, prefs.saver).catch(() => {})
  }, [page, n, next, prefs.saver])

  const urlFor = (i: number) => (failed[i] ? `${src.data!.fallback[i]}${failed[i] > 1 ? `?r=${failed[i]}` : ''}` : urls[i])
  const onImgError = (i: number) => setFailed((f) => (f[i] && f[i] > 2 ? f : { ...f, [i]: (f[i] ?? 0) + 1 }))

  const go = useCallback(
    (to: number) => {
      if (to < 0) {
        if (prev && !prev.external) onChapter(prev)
        return
      }
      if (to > last) {
        if (next && !next.external) onChapter(next)
        return
      }
      setPage(to)
      setUi(false)
    },
    [last, prev, next, onChapter],
  )
  const forward = useCallback(() => go(page >= n - 1 ? last : Math.min(page + step, last)), [go, page, n, last, step])
  const back = useCallback(() => go(page === last ? Math.max(0, n - step) : page - step), [go, page, last, n, step])

  // fullscreen of the reader itself; the app chrome is already hidden behind it
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
  const toggleFull = () => {
    const d = document as Doc
    const el = rootRef.current as El | null
    if (d.fullscreenElement || d.webkitFullscreenElement) void (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())
    else if (el) void (el.requestFullscreen?.().catch(() => {}) ?? el.webkitRequestFullscreen?.())
  }

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Escape') {
        if (panel) setPanel(null)
        else if (!full) onExit()
        return
      }
      if (e.key === 'f' || e.key === 'а') return toggleFull()
      if (!paged) {
        if (e.key === 'ArrowRight' && next) onChapter(next)
        if (e.key === 'ArrowLeft' && prev) onChapter(prev)
        return
      }
      const fwd = rtl ? 'ArrowLeft' : 'ArrowRight'
      const bwd = rtl ? 'ArrowRight' : 'ArrowLeft'
      if (e.key === fwd || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault()
        forward()
      } else if (e.key === bwd || e.key === 'PageUp') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const title = m ? mangaName(m) : ''
  const shownPage = Math.min(page, Math.max(0, n - 1))

  return (
    <div ref={rootRef} className="fixed inset-0 z-[70] flex flex-col select-none" style={{ background: paper.bg, color: paper.fg }}>
      {src.error ? (
        <Center>
          <AlertCircle size={36} className="text-rose-400" />
          <div className="font-bold">Не удалось загрузить главу</div>
          <div className="max-w-sm text-center text-sm opacity-70">{src.error}</div>
          <button onClick={onExit} className="mt-2 rounded-full bg-white/10 px-6 py-3 font-bold">
            Назад
          </button>
        </Center>
      ) : !src.data ? (
        <Center>
          <Loader2 size={36} className="animate-spin opacity-60" />
        </Center>
      ) : n === 0 ? (
        <Center>
          <div className="font-bold">В этой главе нет страниц</div>
          {chapter?.external && (
            <a href={chapter.external} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-black">
              <ExternalLink size={17} /> Открыть у издателя
            </a>
          )}
        </Center>
      ) : paged ? (
        <Paged
          urls={urls}
          urlFor={urlFor}
          onError={onImgError}
          page={page}
          last={last}
          spread={spread}
          rtl={rtl}
          prefs={prefs}
          forward={forward}
          back={back}
          toggleUi={() => setUi((v) => !v)}
          end={<ChapterEnd chapter={chapter} next={next} onNext={() => next && onChapter(next)} onExit={onExit} fg={paper.fg} />}
        />
      ) : (
        <Strip
          urls={urls}
          urlFor={urlFor}
          onError={onImgError}
          startPage={startPage}
          onPage={setPage}
          prefs={prefs}
          toggleUi={() => setUi((v) => !v)}
          hideUi={() => setUi(false)}
          end={<ChapterEnd chapter={chapter} next={next} onNext={() => next && onChapter(next)} onExit={onExit} fg={paper.fg} />}
        />
      )}

      {/* top bar */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/85 to-black/0 px-3 pb-8 text-white transition duration-300 sm:px-5',
          !ui && !panel && '-translate-y-full opacity-0',
        )}
        style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}
      >
        <button onClick={onExit} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-white/15" title="К манге">
          <ArrowLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-extrabold">{title}</div>
          <div className="truncate text-xs font-semibold text-white/70">
            {label}
            {chapter?.group ? ` · ${chapter.group}` : ''}
          </div>
        </div>
        <IconBtn onClick={() => setPanel(panel === 'chapters' ? null : 'chapters')} title="Главы">
          <List size={20} />
        </IconBtn>
        <IconBtn onClick={() => setPanel(panel === 'settings' ? null : 'settings')} title="Настройки чтения">
          <Settings2 size={20} />
        </IconBtn>
        <IconBtn onClick={toggleFull} title="Во весь экран (F)">
          {full ? <Minimize size={20} /> : <Maximize size={20} />}
        </IconBtn>
      </div>

      {/* bottom bar */}
      {n > 0 && (
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 bg-gradient-to-t from-black/85 to-black/0 px-3 pt-10 text-white transition duration-300 sm:px-5',
            !ui && !panel && 'translate-y-full opacity-0',
          )}
          style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
        >
          <IconBtn onClick={() => prev && onChapter(prev)} disabled={!prev || !!prev.external} title="Предыдущая глава">
            <ChevronLeft size={22} />
          </IconBtn>
          <div className={cn('flex min-w-0 flex-1 items-center gap-3', rtl && 'flex-row-reverse')}>
            <input
              type="range"
              min={0}
              max={n - 1}
              value={shownPage}
              onChange={(e) => {
                const v = Number(e.target.value)
                setPage(v)
                if (!paged) document.getElementById(`mp-${v}`)?.scrollIntoView({ block: 'start' })
              }}
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[#a78bfa]"
              style={{ direction: rtl ? 'rtl' : 'ltr' }}
            />
            <span className="shrink-0 text-sm font-bold tabular-nums">
              {shownPage + 1} / {n}
            </span>
          </div>
          <IconBtn onClick={() => next && onChapter(next)} disabled={!next || !!next.external} title="Следующая глава">
            <ChevronRight size={22} />
          </IconBtn>
        </div>
      )}

      {panel && <div className="absolute inset-0 z-20 bg-black/40" onClick={() => setPanel(null)} />}
      {panel === 'settings' && <SettingsSheet prefs={prefs} set={setPrefs} close={() => setPanel(null)} />}
      {panel === 'chapters' && (
        <Sheet title="Главы" close={() => setPanel(null)}>
          <ChapterList list={list} current={chapter} mangaId={mangaId} onPick={(c) => (setPanel(null), onChapter(c))} />
        </Sheet>
      )}
    </div>
  )
}

// --- modes --------------------------------------------------------------------------------------

/** long strip: pages one under another, best for webtoons and phones */
function Strip({
  urls,
  urlFor,
  onError,
  startPage,
  onPage,
  prefs,
  toggleUi,
  hideUi,
  end,
}: {
  urls: string[]
  urlFor: (i: number) => string
  onError: (i: number) => void
  startPage: number
  onPage: (p: number) => void
  prefs: ReaderPrefs
  toggleUi: () => void
  hideUi: () => void
  end: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const lastY = useRef(0)
  const down = useRef<{ x: number; y: number } | null>(null)

  // jump to where reading stopped
  useLayoutEffect(() => {
    if (startPage) document.getElementById(`mp-${startPage}`)?.scrollIntoView({ block: 'start' })
  }, [startPage])

  // the page crossing the middle of the screen is the current one
  const track = useCallback(() => {
    const root = ref.current
    if (!root) return
    const mid = root.scrollTop + root.clientHeight / 2
    const els = root.querySelectorAll<HTMLElement>('[data-i]')
    for (const el of els) if (el.offsetTop + el.offsetHeight > mid) return onPage(Number(el.dataset.i))
  }, [onPage])

  // pages load with unknown heights: when one above the screen grows, scroll by the same amount
  // so the page being read stays put (WebKit has no built-in scroll anchoring)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const heights = new Map<Element, number>()
    const ro = new ResizeObserver((es) => {
      for (const e of es) {
        const el = e.target as HTMLElement
        const h = el.offsetHeight
        const old = heights.get(el)
        heights.set(el, h)
        if (old !== undefined && h !== old && el.offsetTop + old <= root.scrollTop) root.scrollTop += h - old
      }
      track()
    })
    root.querySelectorAll('[data-i]').forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [urls, track])

  return (
    <div
      ref={ref}
      className="no-scrollbar relative flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
      onScroll={(e) => {
        const y = e.currentTarget.scrollTop
        if (y > lastY.current + 30) hideUi()
        lastY.current = y
        track()
      }}
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const d = down.current
        if (d && Math.abs(e.clientX - d.x) < 8 && Math.abs(e.clientY - d.y) < 8) toggleUi()
      }}
    >
      <div className="mx-auto flex flex-col" style={{ maxWidth: prefs.width, gap: prefs.gap ? 12 : 0, filter: prefs.brightness < 1 ? `brightness(${prefs.brightness})` : undefined }}>
        {urls.map((_, i) => (
          <Page key={i} i={i} src={urlFor(i)} onError={onError} eager={Math.abs(i - startPage) < 3} className="w-full" />
        ))}
      </div>
      {end}
    </div>
  )
}

/** one page (or a two-page spread) at a time with tap zones and swipes */
function Paged({
  urls,
  urlFor,
  onError,
  page,
  last,
  spread,
  rtl,
  prefs,
  forward,
  back,
  toggleUi,
  end,
}: {
  urls: string[]
  urlFor: (i: number) => string
  onError: (i: number) => void
  page: number
  last: number
  spread: boolean
  rtl: boolean
  prefs: ReaderPrefs
  forward: () => void
  back: () => void
  toggleUi: () => void
  end: ReactNode
}) {
  const [zoom, setZoom] = useState(false)
  const down = useRef<{ x: number; y: number; t: number } | null>(null)
  const lastTap = useRef(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setZoom(false)
    box.current?.scrollTo({ top: 0, left: 0 })
  }, [page])

  // keep the next few pages in the browser cache
  useEffect(() => {
    for (let i = page + 1; i < Math.min(urls.length, page + 4); i++) new Image().src = urlFor(i)
  }, [page, urls, urlFor])

  const shown = useMemo(() => {
    if (page >= last) return []
    if (!spread) return [page]
    const a = page - (page % 2)
    return a + 1 < urls.length ? [a, a + 1] : [a]
  }, [page, last, spread, urls.length])

  const fit = zoom ? 'original' : prefs.fit
  const imgCls =
    fit === 'height'
      ? 'max-h-full w-auto max-w-full object-contain'
      : fit === 'width'
        ? cn('h-auto', shown.length > 1 ? 'w-1/2' : 'w-full', 'max-w-[1100px]')
        : 'max-w-none'

  const onUp = (e: React.PointerEvent) => {
    const d = down.current
    down.current = null
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    // swipe
    if (!zoom && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) (rtl ? back : forward)()
      else (rtl ? forward : back)()
      return
    }
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) return
    // double tap zooms in
    const now = Date.now()
    if (now - lastTap.current < 280) {
      setZoom((z) => !z)
      lastTap.current = 0
      return
    }
    lastTap.current = now
    const x = e.clientX / window.innerWidth
    setTimeout(() => {
      if (lastTap.current !== now) return
      if (x < 0.3) (rtl ? forward : back)()
      else if (x > 0.7) (rtl ? back : forward)()
      else toggleUi()
    }, 200)
  }

  return (
    <div
      ref={box}
      className={cn('relative flex-1 overscroll-contain', zoom || fit === 'width' ? 'overflow-auto' : 'overflow-hidden')}
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY, t: Date.now() })}
      onPointerUp={onUp}
    >
      {page >= last ? (
        <div className="flex min-h-full items-center justify-center">{end}</div>
      ) : (
        <div
          className={cn('flex min-h-full justify-center', fit === 'height' ? 'h-full items-center' : 'items-start', rtl && 'flex-row-reverse')}
          style={{ filter: prefs.brightness < 1 ? `brightness(${prefs.brightness})` : undefined }}
        >
          {shown.map((i) => (
            <Page key={i} i={i} src={urlFor(i)} onError={onError} eager className={imgCls} />
          ))}
        </div>
      )}
    </div>
  )
}

function Page({ i, src, onError, eager, className }: { i: number; src: string; onError: (i: number) => void; eager?: boolean; className?: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div id={`mp-${i}`} data-i={i} className={cn('relative', !loaded && 'min-h-[70vh] w-full')}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center opacity-40">
          <Loader2 className="animate-spin" />
        </div>
      )}
      <img
        src={src}
        alt=""
        draggable={false}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => onError(i)}
        className={cn('mx-auto block', className)}
      />
    </div>
  )
}

// --- pieces -------------------------------------------------------------------------------------

function ChapterEnd({ chapter, next, onNext, onExit, fg }: { chapter: Chapter | null; next: Chapter | null; onNext: () => void; onExit: () => void; fg: string }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-20 text-center" style={{ color: fg }}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
        <Check size={28} />
      </div>
      <div className="text-xl font-extrabold">{chapter ? `${chapterLabel(chapter)} прочитана` : 'Глава прочитана'}</div>
      {next ? (
        next.external ? (
          <a href={next.external} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full bg-white px-7 py-3.5 font-bold text-black">
            <ExternalLink size={17} /> {chapterLabel(next)} — у издателя
          </a>
        ) : (
          <button onClick={onNext} onPointerUp={(e) => e.stopPropagation()} className="flex items-center gap-2 rounded-full bg-white px-7 py-3.5 font-bold text-black shadow-xl transition hover:scale-[1.03]">
            Дальше: {chapterLabel(next)} <ChevronRight size={18} />
          </button>
        )
      ) : (
        <div className="text-sm opacity-70">Это последняя переведённая глава. Новые появятся здесь, как только их выложат.</div>
      )}
      <button onClick={onExit} onPointerUp={(e) => e.stopPropagation()} className="text-sm font-bold opacity-70 hover:opacity-100">
        К списку глав
      </button>
    </div>
  )
}

function ChapterList({ list, current, mangaId, onPick }: { list: Chapter[]; current: Chapter | null; mangaId: string; onPick: (c: Chapter) => void }) {
  const read = useManga((s) => s.entries[mangaId]?.read)
  const done = useMemo(() => new Set(read ?? []), [read])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('[data-current]')?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <div ref={ref} className="flex flex-col gap-1">
      {[...list].reverse().map((c) => {
        const cur = current && chapterKey(c) === chapterKey(current)
        return (
          <button
            key={c.id}
            data-current={cur || undefined}
            disabled={!!c.external}
            onClick={() => onPick(c)}
            className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/10 disabled:opacity-40', cur && 'bg-accent/25 ring-1 ring-accent/50')}
          >
            <div className="min-w-0 flex-1">
              <div className={cn('truncate text-sm font-bold', done.has(chapterKey(c)) && !cur && 'text-white/45')}>{chapterLabel(c)}</div>
              {c.title && c.num != null && <div className="truncate text-xs text-white/50">{c.title}</div>}
            </div>
            {c.external ? <ExternalLink size={14} /> : done.has(chapterKey(c)) ? <Check size={15} className="text-emerald-400" /> : null}
          </button>
        )
      })}
    </div>
  )
}

function SettingsSheet({ prefs, set, close }: { prefs: ReaderPrefs; set: (p: Partial<ReaderPrefs>) => void; close: () => void }) {
  const wide = window.innerWidth >= 900
  return (
    <Sheet title="Настройки чтения" close={close}>
      <div className="flex flex-col gap-6">
        <Field label="Режим">
          <Seg
            value={prefs.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { v: 'scroll', l: 'Лента', hint: 'Сверху вниз' },
              { v: 'rtl', l: 'Страницы ←', hint: 'Как в оригинале' },
              { v: 'ltr', l: 'Страницы →', hint: 'Слева направо' },
            ]}
          />
        </Field>
        {prefs.mode === 'scroll' ? (
          <>
            <Field label={`Ширина ленты · ${prefs.width}px`}>
              <input type="range" min={360} max={1600} step={20} value={prefs.width} onChange={(e) => set({ width: Number(e.target.value) })} className="w-full accent-[#a78bfa]" />
            </Field>
            <Toggle label="Отступы между страницами" value={prefs.gap} onChange={(gap) => set({ gap })} />
          </>
        ) : (
          <>
            <Field label="Масштаб страницы">
              <Seg
                value={prefs.fit}
                onChange={(fit) => set({ fit })}
                options={[
                  { v: 'height', l: 'По высоте' },
                  { v: 'width', l: 'По ширине' },
                  { v: 'original', l: 'Оригинал' },
                ]}
              />
            </Field>
            {wide && <Toggle label="Разворот — две страницы рядом" value={prefs.spread} onChange={(spread) => set({ spread })} />}
            <div className="-mt-3 text-xs text-white/50">Нажатие у края листает, в центре — показывает меню, двойное нажатие увеличивает.</div>
          </>
        )}
        <Field label="Фон">
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(PAPER) as (keyof typeof PAPER)[]).map((k) => (
              <button
                key={k}
                onClick={() => set({ paper: k })}
                className={cn('flex flex-col items-center gap-1.5 rounded-xl p-2 text-xs font-bold ring-1', prefs.paper === k ? 'ring-accent-2' : 'ring-white/10 hover:ring-white/30')}
              >
                <span className="h-8 w-full rounded-lg ring-1 ring-white/10" style={{ background: PAPER[k].bg }} />
                {PAPER[k].label}
              </button>
            ))}
          </div>
        </Field>
        <Field label={`Яркость · ${Math.round(prefs.brightness * 100)}%`}>
          <input type="range" min={0.3} max={1} step={0.05} value={prefs.brightness} onChange={(e) => set({ brightness: Number(e.target.value) })} className="w-full accent-[#a78bfa]" />
        </Field>
        <Toggle label="Экономия трафика (сжатые страницы)" value={prefs.saver} onChange={(saver) => set({ saver })} />
      </div>
    </Sheet>
  )
}

export function Sheet({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return (
    <div
      className="animate-pop absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col bg-[#15151d]/95 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="text-lg font-extrabold">{title}</div>
        <button onClick={close} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10">
          <X size={20} />
        </button>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-6">{children}</div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-extrabold tracking-wide text-white/50 uppercase">{label}</div>
      {children}
    </div>
  )
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string; hint?: string }[] }) {
  return (
    <div className="grid gap-1 rounded-2xl bg-white/5 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={cn('rounded-xl px-2 py-2 text-sm font-bold transition', value === o.v ? 'bg-white text-black' : 'text-white/70 hover:text-white')}>
          {o.l}
          {o.hint && <div className={cn('text-[10px] font-semibold', value === o.v ? 'text-black/55' : 'text-white/40')}>{o.hint}</div>}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="flex items-center justify-between gap-4 text-left text-sm font-bold">
      {label}
      <span className={cn('relative h-7 w-12 shrink-0 rounded-full transition', value ? 'bg-accent' : 'bg-white/15')}>
        <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white transition-all', value ? 'left-6' : 'left-1')} />
      </span>
    </button>
  )
}

export function IconBtn({ children, onClick, title, disabled }: { children: ReactNode; onClick: () => void; title: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent">
      {children}
    </button>
  )
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">{children}</div>
}
