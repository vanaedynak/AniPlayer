import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, List, Settings2, Maximize, Minimize, Loader2, X, Check, ExternalLink, AlertCircle, Languages, Eye, EyeOff } from 'lucide-react'
import { manga, pages, chapterKey, chapterLabel, mangaName, type Chapter, type Manga } from './md'
import { useManga, type ReaderPrefs } from './store'
import { translatePage, savedTranslation, KEY_URL, MODELS, DEFAULT_MODEL, type Bubble } from './translate'

/** translated bubbles for page i, if any */
const BubblesCtx = createContext<(i: number) => Bubble[] | undefined>(() => undefined)
import { useChapters, pickLang } from './useChapters'
import { PAPER } from './ui'
import { useAsync } from '../lib/useAsync'
import { cn } from '../lib/format'
import { isElectron, isIOS } from '../lib/platform'

type Doc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
type El = HTMLElement & { webkitRequestFullscreen?: () => void }

export default function MangaReader() {
  const { id = '', chapterId = '' } = useParams()
  const nav = useNavigate()
  const m = useAsync(() => manga(id), [id])
  const entryLang = useManga((s) => s.entries[id]?.lang)
  const preferred = useManga((s) => s.prefs.lang)
  const lang = m.data ? pickLang(m.data.langs, entryLang, preferred) : null
  const { list, all } = useChapters(id, lang, m.data?.sk)
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
  // where reading stopped, read once per chapter: saved progress moves on as you read, and following
  // it would yank the strip back to the top of the current page on every save
  const startPage = useMemo(() => {
    const resume = useManga.getState().entries[mangaId]
    return resume?.lastChapterId === chapterId && resume.lastPage && resume.lastPage < (resume.lastPages ?? 0) - 1 ? resume.lastPage : 0
  }, [mangaId, chapterId])
  const src = useAsync(() => pages(chapterId, prefs.saver), [chapterId, prefs.saver])
  const urls = src.data?.urls ?? []
  const n = urls.length
  const [page, setPage] = useState(startPage)
  const [ui, setUi] = useState(true)
  const [panel, setPanel] = useState<null | 'settings' | 'chapters' | 'translate'>(null)
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

  // translator: chapters not in Russian get their bubbles translated, current page first, then AHEAD more
  const canTranslate = !!chapter && chapter.lang !== 'ru'
  const translating = canTranslate && prefs.translate && !!prefs.geminiKey
  const [bubbles, setBubbles] = useState<Record<string, Bubble[]>>({})
  const [trBusy, setTrBusy] = useState(false)
  const [trError, setTrError] = useState('')
  const [original, setOriginal] = useState(false)
  const [trTry, setTrTry] = useState(0)
  const retry = useCallback(() => {
    setTrError('')
    setTrTry((t) => t + 1)
  }, [])
  useEffect(() => {
    if (!translating || !n) return
    let alive = true
    const want = Array.from({ length: AHEAD + 1 }, (_, k) => page + k).filter((i) => i < n).map((i) => urls[i])
    const todo = want.filter((u) => !bubbles[u])
    for (const u of todo) {
      const hit = savedTranslation(u)
      if (hit) setBubbles((b) => ({ ...b, [u]: hit }))
    }
    const missing = todo.filter((u) => !savedTranslation(u))
    if (!missing.length) return
    setTrBusy(missing[0] === urls[page])
    // farthest first: the translator takes the last request first, so the page on screen leads
    missing.slice().reverse().forEach((u) =>
      translatePage(u, { key: prefs.geminiKey, model: prefs.geminiModel || DEFAULT_MODEL, title: m?.title ?? '', alt: src.data?.fallback[urls.indexOf(u)] })
        .then((b) => {
          if (!alive) return
          setBubbles((cur) => ({ ...cur, [u]: b }))
          setTrError('')
        })
        .catch((e) => alive && setTrError(String(e?.message ?? e)))
        .finally(() => alive && u === urls[page] && setTrBusy(false)),
    )
    return () => {
      alive = false
    }
  }, [translating, page, n, urls, bubbles, prefs.geminiKey, prefs.geminiModel, m?.title, trTry])
  const bubblesFor = useCallback((i: number) => (translating && !original ? bubbles[urls[i]] : undefined), [translating, original, bubbles, urls])
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
      if (e.code === 'KeyF') return toggleFull()
      // A / D and the arrows flip pages (by key position, so the Russian layout works too)
      const right = e.key === 'ArrowRight' || e.code === 'KeyD'
      const left = e.key === 'ArrowLeft' || e.code === 'KeyA'
      const fwd = (rtl ? left : right) || e.key === ' ' || e.key === 'PageDown'
      const bwd = (rtl ? right : left) || e.key === 'PageUp'
      if (!fwd && !bwd) return
      e.preventDefault()
      if (paged) return fwd ? forward() : back()
      const root = document.getElementById('manga-strip')
      if (root && !stripStep(root, fwd ? 1 : -1)) {
        if (fwd && next && !next.external) onChapter(next)
        if (bwd && prev && !prev.external) onChapter(prev)
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
        <BubblesCtx.Provider value={bubblesFor}>
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
        </BubblesCtx.Provider>
      ) : (
        <BubblesCtx.Provider value={bubblesFor}>
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
        </BubblesCtx.Provider>
      )}

      {/* top bar */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/85 to-black/0 px-3 pb-8 text-white transition duration-300 sm:px-5',
          // Windows: keep clear of the minimize / maximize / close buttons
          isElectron && !full && 'sm:pr-[150px]',
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
        {canTranslate && (
          <button
            onClick={() => {
              if (!prefs.geminiKey) setPanel('translate')
              else if (!prefs.translate) setPrefs({ translate: true })
              else setOriginal((o) => !o)
            }}
            title={!prefs.geminiKey ? 'Переводчик' : original ? 'Показать перевод' : 'Показать оригинал'}
            className={cn(
              'flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-bold transition hover:bg-white/15',
              translating && !original && 'bg-accent/30 text-accent-2',
            )}
          >
            {trBusy ? <Loader2 size={18} className="animate-spin" /> : translating && original ? <EyeOff size={18} /> : translating ? <Eye size={18} /> : <Languages size={18} />}
            <span className="hidden sm:inline">{translating ? (original ? 'Оригинал' : 'Перевод') : 'Перевести'}</span>
          </button>
        )}
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

      {translating && (trBusy || trError) && (
        <div
          className={cn(
            'absolute left-1/2 z-20 max-w-[90vw] -translate-x-1/2 rounded-2xl px-4 py-2 text-center text-xs font-bold shadow-xl backdrop-blur',
            trError ? 'cursor-pointer bg-rose-500/90 text-white hover:bg-rose-500' : 'bg-black/70 text-white',
          )}
          style={{ bottom: 'calc(var(--safe-bottom) + 76px)' }}
          onClick={retry}
          onPointerUp={(e) => e.stopPropagation()}
        >
          {trError ? (
            <>
              {trError}
              <span className="mt-0.5 block font-semibold opacity-80">Нажмите, чтобы попробовать ещё раз</span>
            </>
          ) : (
            'Перевожу страницу…'
          )}
        </div>
      )}
      {panel && <div className="absolute inset-0 z-20 bg-black/40" onClick={() => setPanel(null)} />}
      {panel === 'translate' && (
        <Sheet title="Переводчик" close={() => setPanel(null)}>
          <TranslatorSetup prefs={prefs} set={setPrefs} onSaved={() => (setPanel(null), retry())} />
        </Sheet>
      )}
      {panel === 'settings' && <SettingsSheet prefs={prefs} set={setPrefs} close={() => setPanel(null)} onSaved={() => (setPanel(null), retry())} />}
      {panel === 'chapters' && (
        <Sheet title="Главы" close={() => setPanel(null)}>
          <ChapterList list={list} current={chapter} mangaId={mangaId} onPick={(c) => (setPanel(null), onChapter(c))} />
        </Sheet>
      )}
    </div>
  )
}

/** how many pages past the current one get translated in advance */
const AHEAD = 5

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
  // so the page being read stays put. Only WebKit needs this: Chromium anchors by itself, and doing
  // it by hand there fights its smooth wheel scrolling (pages jumped over each other)
  useEffect(() => {
    const root = ref.current
    if (!root || !isIOS) return
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
      id="manga-strip"
      className={cn('no-scrollbar relative flex-1 overflow-y-auto overscroll-contain', isIOS && '[overflow-anchor:none]')}
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

/** the strip moved by one page: a page taller than the screen goes by screenfuls.
 *  False when there is nowhere further to go in that direction. */
function stripStep(root: HTMLElement, dir: 1 | -1) {
  const top = root.scrollTop
  const h = root.clientHeight
  const els = [...root.querySelectorAll<HTMLElement>('[data-i]')]
  if (!h || !els.length) return true // not laid out yet: stay in this chapter
  const at = els.findIndex((el) => el.offsetTop + el.offsetHeight > top + 2)
  const cur = els[at]
  if (!cur) {
    // already below the last page, at the chapter's end card
    if (dir > 0) return false
    const last = els[els.length - 1]
    root.scrollTo({ top: Math.max(last.offsetTop, last.offsetTop + last.offsetHeight - h), behavior: 'smooth' })
    return true
  }
  let to: number
  if (dir > 0) {
    const bottom = cur.offsetTop + cur.offsetHeight
    if (bottom > top + h + 2) to = Math.min(top + h * 0.85, bottom - h)
    else to = els[at + 1]?.offsetTop ?? root.scrollHeight - h
    if (to <= top + 1) return false
  } else {
    if (cur.offsetTop < top - 2) to = Math.max(cur.offsetTop, top - h * 0.85)
    else {
      const prev = els[at - 1]
      if (!prev) return false
      to = Math.max(prev.offsetTop, prev.offsetTop + prev.offsetHeight - h)
    }
  }
  root.scrollTo({ top: to, behavior: 'smooth' })
  return true
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
  const bubbles = useContext(BubblesCtx)(i)
  const img = useRef<HTMLImageElement>(null)
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  // the translation layer sits exactly over the drawn image, however it is scaled
  useEffect(() => {
    const el = img.current
    if (!el || !bubbles) return
    const measure = () => setBox({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [bubbles, loaded])
  return (
    <div id={`mp-${i}`} data-i={i} className={cn('relative', !loaded && 'aspect-[5/7] max-h-[90vh] w-full')}>
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
        ref={img}
        onLoad={() => setLoaded(true)}
        onError={() => onError(i)}
        className={cn('mx-auto block', className)}
      />
      {loaded && bubbles && box && (
        <div className="pointer-events-none absolute" style={box}>
          {bubbles.map((b, k) => (
            <FitText key={k} b={b} height={box.height} />
          ))}
        </div>
      )}
    </div>
  )
}

/** one translated bubble: a white patch over the original. The text shrinks to fit, but never below
 *  a readable size; when it still does not fit, the patch grows around the bubble instead */
const MIN_TEXT = 14
function FitText({ b, height }: { b: Bubble; height: number }) {
  const ref = useRef<HTMLDivElement>(null)
  // a little extra room: Russian runs longer than English
  const padX = b.w * 0.1
  const padY = b.h * 0.08
  const pageW = height * 0.7 // pages are roughly this shape; only used to keep narrow bubbles wide enough
  const w = Math.min(1, Math.max(b.w + padX * 2, 120 / pageW))
  const left = Math.min(1 - w, Math.max(0, b.x + b.w / 2 - w / 2))
  const top = Math.max(0, b.y - padY)
  const hgt = Math.min(1 - top, b.h + padY * 2)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = `${hgt * 100}%`
    el.style.marginTop = ''
    let size = Math.max(MIN_TEXT + 2, Math.min(30, height * 0.026))
    el.style.fontSize = `${size}px`
    const over = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
    while (size > MIN_TEXT && over()) {
      size -= 0.5
      el.style.fontSize = `${size}px`
    }
    el.style.width = `${w * 100}%`
    el.style.left = `${left * 100}%`
    if (over()) {
      // first wider, still centred on the bubble
      const wide = Math.min(1, Math.max(w * 1.7, 0.3))
      el.style.width = `${wide * 100}%`
      el.style.left = `${Math.min(1 - wide, Math.max(0, b.x + b.w / 2 - wide / 2)) * 100}%`
    }
    if (over()) {
      // then taller: grow downwards and shift up by half, but not past the top of the page
      const before = el.offsetHeight
      el.style.height = 'auto'
      el.style.marginTop = `${-Math.min(top * height, (el.offsetHeight - before) / 2)}px`
    }
  }, [b, height, hgt, w, left, top])
  return (
    <div
      ref={ref}
      title={b.text}
      className="absolute flex items-center justify-center rounded-[40%/30%] bg-white px-[3%] py-1 text-center leading-[1.15] font-bold text-black shadow-[0_0_6px_4px_white] [overflow-wrap:anywhere]"
      style={{
        top: `${top * 100}%`,
        fontFamily: '"Comic Neue", "Manrope Variable", system-ui, sans-serif',
      }}
    >
      {b.ru}
    </div>
  )
}

/** key entry and switches for the Gemini translator */
function TranslatorSetup({ prefs, set, onSaved }: { prefs: ReaderPrefs; set: (p: Partial<ReaderPrefs>) => void; onSaved?: () => void }) {
  const [key, setKey] = useState(prefs.geminiKey)
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="leading-relaxed text-white/75">
        Перевод делает нейросеть <b className="text-white">Gemini</b>: она видит страницу целиком, находит все реплики и переводит их на русский с учётом сцены,
        характера героев и игры слов — поверх оригинальных облачков. Работает для глав на английском и японском.
      </div>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-white/75">
        <li>
          Откройте{' '}
          <a href={KEY_URL} target="_blank" rel="noreferrer" className="font-bold text-accent-2 underline">
            aistudio.google.com/apikey
          </a>{' '}
          и войдите в Google-аккаунт.
        </li>
        <li>Нажмите «Create API key» и скопируйте ключ.</li>
        <li>Вставьте его сюда. Это бесплатно: хватает на несколько глав в день.</li>
      </ol>
      <input
        value={key}
        onChange={(e) => setKey(e.target.value.trim())}
        placeholder="Ключ из AI Studio"
        spellCheck={false}
        autoComplete="off"
        className="h-11 rounded-xl bg-white/10 px-4 font-mono text-sm ring-1 ring-white/10 outline-none focus:ring-accent"
      />
      <button
        onClick={() => {
          set({ geminiKey: key, translate: true })
          onSaved?.()
        }}
        disabled={!key}
        className="h-11 rounded-xl bg-white font-bold text-black transition active:scale-[0.98] disabled:opacity-40"
      >
        {prefs.geminiKey && key === prefs.geminiKey ? 'Сохранить и перевести' : 'Сохранить ключ'}
      </button>
      <Toggle label="Переводить главы не на русском" value={prefs.translate} onChange={(translate) => set({ translate })} />
      <Field label="Модель">
        <select
          value={prefs.geminiModel}
          onChange={(e) => set({ geminiModel: e.target.value })}
          className="h-10 w-full rounded-xl bg-white/10 px-3 text-sm font-bold ring-1 ring-white/10 outline-none"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="text-xs text-white/45">Ключ хранится только на этом устройстве. Готовые переводы запоминаются, повторное чтение квоту не тратит.</div>
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
              <div className={cn('truncate text-sm font-bold', done.has(chapterKey(c)) && !cur && 'text-white/45')}>
                {c.lang !== current?.lang && c.lang !== list[0]?.lang && <span className="mr-1.5 rounded bg-sky-500/20 px-1.5 text-[10px] font-extrabold text-sky-300 uppercase">{c.lang}</span>}
                {chapterLabel(c)}
              </div>
              {c.title && c.num != null && <div className="truncate text-xs text-white/50">{c.title}</div>}
            </div>
            {c.external ? <ExternalLink size={14} /> : done.has(chapterKey(c)) ? <Check size={15} className="text-emerald-400" /> : null}
          </button>
        )
      })}
    </div>
  )
}

function SettingsSheet({ prefs, set, close, onSaved }: { prefs: ReaderPrefs; set: (p: Partial<ReaderPrefs>) => void; close: () => void; onSaved: () => void }) {
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
        <div className="mt-2 border-t border-white/10 pt-5">
          <div className="mb-3 text-xs font-extrabold tracking-wide text-white/50 uppercase">Переводчик</div>
          <TranslatorSetup prefs={prefs} set={set} onSaved={onSaved} />
        </div>
      </div>
    </Sheet>
  )
}

export function Sheet({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return (
    <div
      className={cn('animate-pop absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col bg-[#15151d]/95 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl', isElectron && 'pt-14')}
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
