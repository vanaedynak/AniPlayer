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
import { useReadingClock } from '../lib/activity'
import { awayAfter, minutesLeft, pagePace, usePagePace, usePresence } from '../lib/reading'
import { PageCurl, type CurlHandle } from './PageCurl'
import { GlossaryEditor } from './GlossaryEditor'
import { savedChapter, savedManga, savedPages, useSaved } from './saved'

type Doc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
type El = HTMLElement & { webkitRequestFullscreen?: () => void }

export default function MangaReader() {
  const { id = '', chapterId = '' } = useParams()
  const nav = useNavigate()
  useReadingClock()
  // with no connection, the title and its chapter list come from what was downloaded
  const m = useAsync(() => manga(id).catch(async (e) => (await savedManga(id)) ?? Promise.reject(e)), [id])
  const entryLang = useManga((s) => s.entries[id]?.lang)
  const preferred = useManga((s) => s.prefs.lang)
  const lang = m.data ? pickLang(m.data.langs, entryLang, preferred) : null
  const online = useChapters(id, lang, m.data?.sk)
  const savedItems = useSaved((s) => s.items)
  const offline = useMemo(
    () => Object.values(savedItems).filter((i) => i.entry === id && i.status === 'done' && i.chapter).sort((a, b) => a.order - b.order).map((i) => i.chapter!),
    [savedItems, id],
  )
  const list = online.list.length ? online.list : offline
  const all = online.all.length ? online.all : offline
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
  const src = useAsync(() => readPages(mangaId, chapterId, prefs.saver), [mangaId, chapterId, prefs.saver])
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

  // the screen stays on while someone reads; their pace says how long the chapter has left
  const present = usePresence(awayAfter(pagePace()))
  const perPage = usePagePace(page, present)
  const left = n && page < n ? minutesLeft((n - page - 0.5) * perPage) : ''

  const paged = prefs.mode !== 'scroll'
  const rtl = prefs.mode === 'rtl'
  const wide = typeof window !== 'undefined' && window.innerWidth > window.innerHeight && window.innerWidth >= 900
  const spread = paged && prefs.spread && wide
  // the extra slot after the last page is the "chapter finished" screen
  const last = n

  // smart spreads: pages go in pairs, but the first one (the cover) and wide pages (a two-page drawing
  // already) stand alone, so the pairs never slip out of step. Page shapes come in as the pictures load.
  const [shape, setShape] = useState<Record<number, number>>({})
  useEffect(() => {
    if (!spread) return
    let alive = true
    urls.forEach((u, i) => {
      const im = new Image()
      im.referrerPolicy = 'no-referrer'
      im.onload = () => alive && setShape((s) => (s[i] ? s : { ...s, [i]: im.naturalWidth / im.naturalHeight }))
      im.src = u
    })
    return () => {
      alive = false
    }
  }, [spread, src.data])
  const slots = useMemo(() => {
    if (!spread) return Array.from({ length: n }, (_, i) => [i])
    const isWide = (k: number) => (shape[k] ?? 0.7) > 1
    const out: number[][] = []
    for (let i = 0; i < n; ) {
      if (i === 0 || isWide(i) || i + 1 >= n || isWide(i + 1)) out.push([i++])
      else {
        out.push([i, i + 1])
        i += 2
      }
    }
    return out
  }, [spread, n, shape])
  const slotOf = useCallback((p: number) => Math.max(0, slots.findIndex((s) => s.includes(p))), [slots])
  /** where a turn forward / back lands from page p: null past the chapter's ends */
  const nextOf = useCallback((p: number) => (p >= last ? null : (slots[slotOf(p) + 1]?.[0] ?? last)), [last, slots, slotOf])
  const prevOf = useCallback((p: number) => (p >= last ? (slots.at(-1)?.[0] ?? null) : slotOf(p) > 0 ? slots[slotOf(p) - 1][0] : null), [last, slots, slotOf])
  const curl = useRef<CurlHandle>(null)

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
    if (next && !next.external && n && page >= n - 3 && !savedChapter(mangaId, next.id)) void pages(next.id, prefs.saver).catch(() => {})
  }, [page, n, next, prefs.saver])

  const urlFor = (i: number) => (failed[i] ? `${src.data!.fallback[i]}${failed[i] > 1 ? `?r=${failed[i]}` : ''}` : urls[i])

  // translator: chapters not in Russian get their bubbles translated, current page first, then AHEAD more
  const canTranslate = !!chapter && chapter.lang !== 'ru'
  const hasKey = prefs.geminiKeys.some((k) => k.trim())
  const translating = canTranslate && prefs.translate && hasKey
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
      translatePage(u, { keys: prefs.geminiKeys, model: prefs.geminiModel || DEFAULT_MODEL, title: m?.title ?? '', glossary: mangaId, alt: src.data?.fallback[urls.indexOf(u)] })
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
  }, [translating, page, n, urls, bubbles, prefs.geminiKeys, prefs.geminiModel, m?.title, trTry])
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
  const forward = useCallback(() => go(nextOf(page) ?? last + 1), [go, page, last, nextOf])
  const back = useCallback(() => go(prevOf(page) ?? -1), [go, page, prevOf])
  /** a turn with the paper animation when it is on and the page is there, else straight away */
  const turn = useCallback(
    (dir: 1 | -1) => {
      if (curl.current?.turn(dir)) return setUi(false)
      if (dir > 0) forward()
      else back()
    },
    [forward, back],
  )

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
      if (paged) return turn(fwd ? 1 : -1)
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
          slotFor={(p) => slots[slotOf(p)] ?? []}
          next={nextOf(page)}
          prev={prevOf(page)}
          goTo={go}
          curl={curl}
          paper={paper.bg}
          rtl={rtl}
          prefs={prefs}
          turn={turn}
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
            {left && <span className="text-white/90"> · до конца главы {left}</span>}
          </div>
        </div>
      </div>

      {/* bottom bar */}
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 bg-gradient-to-t from-black/90 via-black/60 to-black/0 px-3 pt-12 text-white transition duration-300 sm:px-5',
            !ui && !panel && 'translate-y-full opacity-0',
          )}
          style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
        >
          {/* the reader's controls sit at the bottom, where the thumb and the mouse already are */}
          <div className="flex items-center justify-center gap-1 sm:gap-2">
            <IconBtn onClick={() => setPanel(panel === 'chapters' ? null : 'chapters')} title="Главы">
              <List size={20} />
            </IconBtn>
            {canTranslate && (
              <button
                onClick={() => {
                  if (!hasKey) setPanel('translate')
                  else if (!prefs.translate) setPrefs({ translate: true })
                  else setOriginal((o) => !o)
                }}
                title={!hasKey ? 'Переводчик' : original ? 'Показать перевод' : 'Показать оригинал'}
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
            {paged && <ZoomPill zoom={prefs.pageZoom ?? 1} set={(z) => setPrefs({ pageZoom: Math.round(Math.min(ZOOM_MAX, Math.max(1, z)) * 100) / 100 })} />}
          </div>
          {n > 0 && <div className="flex items-center gap-3">
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
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent-2"
              style={{ direction: rtl ? 'rtl' : 'ltr' }}
            />
            <span className="shrink-0 text-sm font-bold tabular-nums">
              {shownPage + 1} / {n}
            </span>
          </div>
          <IconBtn onClick={() => next && onChapter(next)} disabled={!next || !!next.external} title="Следующая глава">
            <ChevronRight size={22} />
          </IconBtn>
          </div>}
        </div>

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
          <TranslatorSetup prefs={prefs} set={setPrefs} glossary={mangaId} onSaved={() => (setPanel(null), retry())} />
        </Sheet>
      )}
      {panel === 'settings' && <SettingsSheet prefs={prefs} set={setPrefs} glossary={canTranslate ? mangaId : undefined} close={() => setPanel(null)} onSaved={() => (setPanel(null), retry())} />}
      {panel === 'chapters' && (
        <Sheet title="Главы" close={() => setPanel(null)}>
          <ChapterList list={list} current={chapter} mangaId={mangaId} onPick={(c) => (setPanel(null), onChapter(c))} />
        </Sheet>
      )}
    </div>
  )
}

/** a chapter's pages: from the device when it was downloaded, else from the network */
async function readPages(mangaId: string, chapterId: string, saver: boolean) {
  const it = savedChapter(mangaId, chapterId)
  if (it) {
    try {
      const urls = await savedPages(it)
      return { urls, fallback: urls }
    } catch {
      /* the files are gone: read it online */
    }
  }
  return pages(chapterId, saver)
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

/** one page (or a two-page spread) at a time with tap zones, and pages that turn like paper when pulled */
function Paged({
  urls,
  urlFor,
  onError,
  page,
  last,
  slotFor,
  next,
  prev,
  goTo,
  curl,
  paper,
  rtl,
  prefs,
  turn,
  toggleUi,
  end,
}: {
  urls: string[]
  urlFor: (i: number) => string
  onError: (i: number) => void
  page: number
  last: number
  /** the pages shown together with page p */
  slotFor: (p: number) => number[]
  next: number | null
  prev: number | null
  goTo: (p: number) => void
  curl: React.RefObject<CurlHandle | null>
  paper: string
  rtl: boolean
  prefs: ReaderPrefs
  turn: (dir: 1 | -1) => void
  toggleUi: () => void
  end: ReactNode
}) {
  const setPrefs = useManga((s) => s.setPrefs)
  const zoom = prefs.pageZoom ?? 1
  const zoomed = zoom > 1.01
  const curlOn = prefs.curl !== false && !zoomed
  const down = useRef<{ x: number; y: number; t: number; sx: number; sy: number } | null>(null)
  const lastTap = useRef(0)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    box.current?.scrollTo({ top: 0, left: 0 })
  }, [page])

  // zoom keeps the point under the cursor (or the middle of the screen) where it was
  const setZoom = useCallback(
    (z: number, at?: { x: number; y: number }) => {
      const el = box.current
      const next = Math.round(Math.min(ZOOM_MAX, Math.max(1, z)) * 100) / 100
      if (!el || next === zoom) return
      const r = el.getBoundingClientRect()
      const px = at ? at.x - r.left : el.clientWidth / 2
      const py = at ? at.y - r.top : el.clientHeight / 2
      const k = next / zoom
      const left = (el.scrollLeft + px) * k - px
      const top = (el.scrollTop + py) * k - py
      setPrefs({ pageZoom: next })
      requestAnimationFrame(() => el.scrollTo({ left, top }))
    },
    [zoom, setPrefs],
  )

  // Ctrl + wheel (and pinch on a touchpad) zooms; the plain wheel just scrolls the page
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), { x: e.clientX, y: e.clientY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, setZoom])

  // + / - / 0 on the keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return
      if (e.key === '+' || e.key === '=') setZoom(zoom + ZOOM_STEP)
      else if (e.key === '-' || e.key === '_') setZoom(zoom - ZOOM_STEP)
      else if (e.key === '0') setZoom(1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, setZoom])

  // keep the next few pages in the browser cache (and the one behind, for turning back)
  useEffect(() => {
    for (let i = Math.max(0, page - 1); i < Math.min(urls.length, page + 4); i++) if (i !== page) new Image().src = urlFor(i)
  }, [page, urls, urlFor])

  const fit = prefs.fit
  const imgCls = (two: boolean) =>
    fit === 'height'
      ? cn('max-h-full w-auto object-contain', !zoomed && 'max-w-full')
      : fit === 'width'
        ? cn('h-auto', two ? 'w-1/2' : 'w-full', !zoomed && 'max-w-[1100px]')
        : 'max-w-none'
  // zoom: the fitted size times the zoom, so the page grows and the box scrolls over it
  const zoomBox = (two: boolean): React.CSSProperties | undefined =>
    !zoomed
      ? undefined
      : fit === 'height'
        ? { height: `${zoom * 100}%` }
        : fit === 'width'
          ? { width: `calc(min(100%, ${two ? 2200 : 1100}px) * ${zoom})` }
          : { zoom }

  /** what stands at position p: its page or spread, or the end-of-chapter card */
  const view = (p: number) => {
    if (p >= last) return <div className="flex min-h-full items-center justify-center">{end}</div>
    const shown = slotFor(p)
    const two = shown.length > 1
    return (
      <div
        className={cn(
          'flex min-h-full justify-center',
          fit === 'height' ? cn('items-center', !zoomed && 'h-full') : 'items-start',
          rtl && 'flex-row-reverse',
          zoomed && 'mx-auto min-w-full',
          zoomed && fit === 'height' && 'w-max',
        )}
        style={{ filter: prefs.brightness < 1 ? `brightness(${prefs.brightness})` : undefined, ...zoomBox(two) }}
      >
        {shown.map((i) => (
          <Page key={i} i={i} src={urlFor(i)} onError={onError} eager className={imgCls(two)} wrap={fit === 'height' ? 'flex h-full items-center' : undefined} />
        ))}
      </div>
    )
  }

  // a zoomed page is dragged around with the mouse
  const onMove = (e: React.PointerEvent) => {
    const d = down.current
    const el = box.current
    if (!d || !el || !zoomed || e.pointerType !== 'mouse' || !(e.buttons & 1)) return
    el.scrollTo({ left: d.sx - (e.clientX - d.x), top: d.sy - (e.clientY - d.y) })
  }

  const onUp = (e: React.PointerEvent) => {
    const d = down.current
    down.current = null
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    // a swipe (the paper turn takes the drag itself when it is on)
    if (!zoomed && !curlOn && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      turn((dx < 0) !== rtl ? 1 : -1)
      return
    }
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) return
    // double tap zooms in to 2× and back
    const now = Date.now()
    if (now - lastTap.current < 280) {
      setZoom(zoomed ? 1 : 2, { x: e.clientX, y: e.clientY })
      lastTap.current = 0
      return
    }
    lastTap.current = now
    const x = e.clientX / window.innerWidth
    setTimeout(() => {
      if (lastTap.current !== now) return
      if (x < 0.3) turn(rtl ? 1 : -1)
      else if (x > 0.7) turn(rtl ? -1 : 1)
      else toggleUi()
    }, 200)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <PageCurl
        ref={curl}
        enabled={curlOn}
        sound={prefs.flipSound !== false}
        rtl={rtl}
        paper={paper}
        canNext={next != null}
        canPrev={prev != null}
        onNext={() => next != null && goTo(next)}
        onPrev={() => prev != null && goTo(prev)}
        render={(at) =>
          at === 0 ? (
            <div
              ref={box}
              className={cn('no-scrollbar relative flex-1 overflow-auto overscroll-contain', zoomed && 'cursor-grab active:cursor-grabbing')}
              onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY, t: Date.now(), sx: box.current?.scrollLeft ?? 0, sy: box.current?.scrollTop ?? 0 })}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              {view(page)}
            </div>
          ) : (
            <div className="relative flex-1 overflow-hidden">{view((at > 0 ? next : prev) ?? page)}</div>
          )
        }
      />
    </div>
  )
}

const ZOOM_MAX = 4
const ZOOM_STEP = 0.25

/** − 150% + among the page mode controls */
function ZoomPill({ zoom, set }: { zoom: number; set: (z: number) => void }) {
  return (
    <div
      className="ml-1 flex items-center gap-1 rounded-full bg-white/10 p-1"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <button onClick={() => set(zoom - ZOOM_STEP)} disabled={zoom <= 1} title="Уменьшить (−)" className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold hover:bg-white/15 disabled:opacity-30">
        −
      </button>
      <button onClick={() => set(1)} title="Как было (0)" className="min-w-12 rounded-full px-1 text-xs font-bold tabular-nums hover:bg-white/15">
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={() => set(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} title="Увеличить (+, Ctrl + колёсико)" className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold hover:bg-white/15 disabled:opacity-30">
        +
      </button>
    </div>
  )
}

function Page({
  i,
  src,
  onError,
  eager,
  className,
  wrap,
}: {
  i: number
  src: string
  onError: (i: number) => void
  eager?: boolean
  className?: string
  /** classes for the page's own box (fit-to-height needs it as tall as the screen) */
  wrap?: string
}) {
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
    <div id={`mp-${i}`} data-i={i} className={cn('relative', wrap, !loaded && 'aspect-[5/7] max-h-[90vh] w-full')}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center opacity-40">
          <Loader2 className="animate-spin" />
        </div>
      )}
      <img
        src={src}
        alt=""
        draggable={false}
        referrerPolicy="no-referrer"
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        ref={img}
        onLoad={() => setLoaded(true)}
        onError={() => onError(i)}
        className={cn('mx-auto block', className)}
      />
      {loaded && bubbles && box && (
        <div className="pointer-events-none absolute" style={box}>
          <Bubbles list={bubbles} width={box.width} height={box.height} />
        </div>
      )}
    </div>
  )
}

/** the translated bubbles of one page: white patches over the originals. Text shrinks to fit, but stays
 *  readable; when it still does not fit, a patch grows into the free space around its bubble, never
 *  over a neighbouring bubble */
const MIN_TEXT = 13
const LAST_RESORT = 10
function Bubbles({ list, width, height }: { list: Bubble[]; width: number; height: number }) {
  const refs = useRef<(HTMLDivElement | null)[]>([])
  useLayoutEffect(() => {
    const raw = list.map((b) => ({ l: b.x * width, t: b.y * height, r: (b.x + b.w) * width, b: (b.y + b.h) * height }))
    const placed: (typeof raw)[number][] = []
    raw.forEach((me, k) => {
      const el = refs.current[k]
      if (!el) return
      const cx = (me.l + me.r) / 2
      const cy = (me.t + me.b) / 2
      // patches already laid out, and the original bubbles of the ones still to come
      const others = raw.map((o, j) => (j < k ? placed[j] : o)).filter((o, j) => j !== k && o)
      // a rect of the given size centred on the bubble, inside the page, cut back where it would cover
      // another bubble (along the side that bubble is on; ones overlapping in the original are left be)
      const place = (w: number, h: number) => {
        let l = Math.max(0, Math.min(width - w, cx - w / 2))
        let t = Math.max(0, Math.min(height - h, cy - h / 2))
        let r = Math.min(width, l + w)
        let bt = Math.min(height, t + h)
        for (const o of others) {
          if (!(o.l < r && o.r > l && o.t < bt && o.b > t)) continue
          if (o.r <= me.l) l = Math.max(l, o.r + 3)
          else if (o.l >= me.r) r = Math.min(r, o.l - 3)
          else if (o.b <= me.t) t = Math.max(t, o.b + 3)
          else if (o.t >= me.b) bt = Math.min(bt, o.t - 3)
        }
        placed[k] = { l, t, r, b: bt }
        Object.assign(el.style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${bt - t}px` })
      }
      const over = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1
      let size = Math.max(MIN_TEXT + 3, Math.min(30, height * 0.026))
      const shrink = (floor: number) => {
        el.style.fontSize = `${size}px`
        while (size > floor && over()) {
          size -= 0.5
          el.style.fontSize = `${size}px`
        }
      }
      el.style.overflowWrap = 'normal'
      // a little extra room: Russian runs longer than English
      const w0 = Math.max(me.r - me.l, 0) * 1.2
      const h0 = Math.max(me.b - me.t, 0) * 1.16
      place(Math.max(w0, 110), h0)
      shrink(MIN_TEXT)
      if (over()) {
        place(Math.max(w0 * 1.8, 170), h0)
        shrink(MIN_TEXT)
      }
      if (over()) {
        place(Math.max(w0 * 1.8, 170), h0 * 1.8)
        shrink(MIN_TEXT)
      }
      if (over()) shrink(LAST_RESORT)
      if (over()) el.style.overflowWrap = 'anywhere'
    })
  }, [list, width, height])
  return (
    <>
      {list.map((b, k) => (
        <div
          key={k}
          ref={(el) => {
            refs.current[k] = el
          }}
          title={b.text}
          className="absolute flex items-center justify-center overflow-hidden rounded-[40%/30%] bg-white px-[3%] py-1 text-center leading-[1.15] font-bold text-black shadow-[0_0_6px_4px_white]"
          style={{ fontFamily: '"Comic Neue", "Manrope Variable", system-ui, sans-serif' }}
        >
          {b.ru}
        </div>
      ))}
    </>
  )
}

const KEY_SLOTS = 5

/** key entry and switches for the Gemini translator */
export function TranslatorSetup({
  prefs,
  set,
  onSaved,
  book,
  glossary,
}: {
  prefs: ReaderPrefs
  set: (p: Partial<ReaderPrefs>) => void
  onSaved?: () => void
  book?: boolean
  /** the title whose names list to show */
  glossary?: string
}) {
  const [keys, setKeys] = useState(() => Array.from({ length: KEY_SLOTS }, (_, i) => prefs.geminiKeys[i] ?? ''))
  const saved = keys.join('|') === Array.from({ length: KEY_SLOTS }, (_, i) => prefs.geminiKeys[i] ?? '').join('|')
  const any = keys.some(Boolean)
  return (
    <div className="flex flex-col gap-4 text-sm">
      {book ? (
        <div className="leading-relaxed text-white/75">
          Перевод делает нейросеть <b className="text-white">Gemini</b>: глава уходит к ней по кускам и возвращается на русском, абзац в абзац — с голосами героев,
          шутками и анимешной подачей. Переведённые главы сохраняются вместе с книгой. Ключи общие с переводчиком манги.
        </div>
      ) : (
        <div className="leading-relaxed text-white/75">
          Перевод делает нейросеть <b className="text-white">Gemini</b>: она видит страницу целиком, находит все реплики и переводит их на русский с учётом сцены,
          характера героев и игры слов — поверх оригинальных облачков. Работает для глав на английском и японском.
        </div>
      )}
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
      <div className="flex flex-col gap-2">
        {keys.map((k, i) => (
          <input
            key={i}
            value={k}
            onChange={(e) => setKeys((cur) => cur.map((v, j) => (j === i ? e.target.value.trim() : v)))}
            placeholder={i ? `Запасной ключ ${i + 1} (другой Google-аккаунт)` : 'Ключ из AI Studio'}
            spellCheck={false}
            autoComplete="off"
            className="h-11 rounded-xl bg-white/10 px-4 font-mono text-sm ring-1 ring-white/10 outline-none focus:ring-accent"
          />
        ))}
        <div className="text-xs text-white/45">Когда у ключа кончаются бесплатные запросы или он перестаёт работать, перевод сам переходит на следующий.</div>
      </div>
      <button
        onClick={() => {
          set({ geminiKeys: keys.filter(Boolean), translate: true })
          onSaved?.()
        }}
        disabled={!any}
        className="h-11 rounded-xl bg-white font-bold text-black transition active:scale-[0.98] disabled:opacity-40"
      >
        {saved ? 'Сохранить и перевести' : 'Сохранить ключи'}
      </button>
      {!book && <Toggle label="Переводить главы не на русском" value={prefs.translate} onChange={(translate) => set({ translate })} />}
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
      {glossary && (
        <div className="mt-2 border-t border-white/10 pt-5">
          <GlossaryEditor title={glossary} />
        </div>
      )}
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

function SettingsSheet({ prefs, set, close, onSaved, glossary }: { prefs: ReaderPrefs; set: (p: Partial<ReaderPrefs>) => void; close: () => void; onSaved: () => void; glossary?: string }) {
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
              <input type="range" min={360} max={1600} step={20} value={prefs.width} onChange={(e) => set({ width: Number(e.target.value) })} className="w-full accent-accent-2" />
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
            <Toggle label="Перелистывание как у бумажной книги" value={prefs.curl !== false} onChange={(curl) => set({ curl })} />
            {prefs.curl !== false && <Toggle label="Звук перелистывания" value={prefs.flipSound !== false} onChange={(flipSound) => set({ flipSound })} />}
            {wide && <Toggle label="Разворот — две страницы рядом" value={prefs.spread} onChange={(spread) => set({ spread })} />}
            {wide && prefs.spread && <div className="-mt-3 text-xs text-white/50">Обложка и широкие страницы-развороты показываются по одной, чтобы пары не сбивались.</div>}
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
          <input type="range" min={0.3} max={1} step={0.05} value={prefs.brightness} onChange={(e) => set({ brightness: Number(e.target.value) })} className="w-full accent-accent-2" />
        </Field>
        <Toggle label="Экономия трафика (сжатые страницы)" value={prefs.saver} onChange={(saver) => set({ saver })} />
        <div className="mt-2 border-t border-white/10 pt-5">
          <div className="mb-3 text-xs font-extrabold tracking-wide text-white/50 uppercase">Переводчик</div>
          <TranslatorSetup prefs={prefs} set={set} onSaved={onSaved} glossary={glossary} />
        </div>
      </div>
    </Sheet>
  )
}

export function Sheet({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return (
    <div
      className={cn('animate-pop absolute inset-y-0 right-0 z-30 flex w-full max-w-sm flex-col bg-card/95 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl', isElectron && 'pt-14')}
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
