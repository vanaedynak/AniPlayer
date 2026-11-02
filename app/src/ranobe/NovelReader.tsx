import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, List, Type, Loader2, AlertCircle, Languages, Headphones, Maximize, Minimize } from 'lucide-react'
import { useManga } from '../manga/store'
import { PAPER } from '../manga/ui'
import { Sheet, IconBtn, TranslatorSetup } from '../manga/Reader'
import { FONTS, TypeSheet } from '../manga/BookReader'
import { Narrator } from '../manga/Narrator'
import { isRussian, savedChapter, translateChapter } from '../manga/bookTranslate'
import { DEFAULT_MODEL } from '../manga/translate'
import { cn } from '../lib/format'
import { isElectron } from '../lib/platform'
import { useReadingClock } from '../lib/activity'
import { awayAfter, minutesLeft, usePresence, useTextPace, wordCount } from '../lib/reading'
import { PageCurl, type CurlHandle } from '../manga/PageCurl'
import { SelectionTranslate } from '../manga/SelectionTranslate'
import { sourceById } from './registry'
import { loadChapter, loadNovel } from './cache'
import { chapterPath, entryId, fileKey, novelPath, rememberNovel } from './shelf'
import type { Novel } from './sources'

type Doc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }

/** reads a chapter from an online source: typography, scroll or page mode, Gemini translation, reading aloud */
export default function NovelReader() {
  const { src = '', id = '', ch = '' } = useParams()
  const novelId = decodeURIComponent(id)
  const chapterId = decodeURIComponent(ch)
  useReadingClock()
  const nav = useNavigate()
  const source = sourceById(src)
  const prefs = useManga((s) => s.book)
  const setBook = useManga((s) => s.setBook)
  const tr = useManga((s) => s.prefs)
  const setPrefs = useManga((s) => s.setPrefs)
  const eid = entryId(src, novelId)
  const saved = useManga((s) => s.entries[eid])
  const paper = PAPER[prefs.paper]

  const [novel, setNovel] = useState<Novel | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [ui, setUi] = useState(true)
  const [panel, setPanel] = useState<null | 'toc' | 'type' | 'translate'>(null)
  const [narrate, setNarrate] = useState(false)
  const [full, setFull] = useState(false)
  const [frac, setFrac] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const curl = useRef<CurlHandle>(null)
  const lastWheel = useRef(0)
  const scroller = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const lastY = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // back to the saved spot in the chapter the reader stopped at; other chapters start at the top
  const restore = useRef(saved?.lastChapterId === chapterId ? (saved.lastPage ?? 0) / (saved.lastPages || 100) : 0)

  useEffect(() => {
    let alive = true
    loadNovel(src, novelId)
      .then((n) => {
        if (!alive) return
        setNovel(n)
        rememberNovel(src, n, source?.lang ?? 'ru')
      })
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [src, novelId, source?.lang])

  useEffect(() => {
    let alive = true
    setHtml(null)
    setError('')
    loadChapter(src, novelId, chapterId)
      .then((h) => alive && setHtml(h))
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [src, novelId, chapterId])

  const idx = novel ? novel.chapters.findIndex((c) => c.id === chapterId) : -1
  const chapter = novel?.chapters[idx]
  const prev = novel?.chapters[idx - 1]
  const next = novel?.chapters[idx + 1]

  // the next chapter loads while this one is read
  useEffect(() => {
    if (html && next) void loadChapter(src, novelId, next.id).catch(() => {})
  }, [html, next, src, novelId])

  // translation of chapters that are not in Russian, shown batch by batch
  const hasKey = tr.geminiKeys.some((k) => k.trim())
  const foreign = !!html && !isRussian(html)
  const translating = prefs.translate && foreign && hasKey
  const [ru, setRu] = useState<{ ch: string; html: string; done: number; total: number } | null>(null)
  const [trError, setTrError] = useState('')
  const [trTry, setTrTry] = useState(0)
  useEffect(() => {
    if (!translating || !html || idx < 0) return
    let alive = true
    setTrError('')
    const key = fileKey(eid)
    const ctx = { keys: tr.geminiKeys, model: tr.geminiModel || DEFAULT_MODEL, title: novel?.title ?? '' }
    void savedChapter(key, idx).then((hit) => {
      if (!alive) return
      setRu(hit ? { ch: chapterId, html: hit, done: 1, total: 1 } : { ch: chapterId, html: '', done: 0, total: 0 })
      translateChapter(key, idx, html, ctx, (h, done, total) => alive && setRu({ ch: chapterId, html: h, done, total }))
        .then((h) => alive && setRu({ ch: chapterId, html: h, done: 1, total: 1 }))
        .catch((e) => alive && setTrError(String(e?.message ?? e)))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translating, html, idx, chapterId, tr.geminiKeys, tr.geminiModel, trTry])
  const shownRu = translating && ru?.ch === chapterId && ru.html ? ru : null
  const trBusy = translating && !trError && (!ru || ru.ch !== chapterId || ru.done < ru.total || !ru.html)

  // the screen stays on while someone reads or listens; their pace says how long the chapter has left
  const present = usePresence(awayAfter(80), narrate && speaking)
  const shownHtml = shownRu?.html || html || ''
  const words = useMemo(() => wordCount(shownHtml.replace(/<[^>]+>/g, ' ')), [shownHtml])
  const wpm = useTextPace(words, frac, present)
  const left = minutesLeft(((words * (1 - frac)) / wpm) * 60)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !html) return
    el.scrollTop = restore.current * (el.scrollHeight - el.clientHeight)
    restore.current = 0
  }, [html])

  const go = (c?: { id: string }) => {
    if (!c) return
    scroller.current?.scrollTo({ top: 0 })
    setFrac(0)
    nav(chapterPath(src, novelId, c.id), { replace: true })
  }

  const save = (f: number) => {
    if (!chapter) return
    useManga.getState().progress(eid, { chapterId, label: chapter.title, page: Math.round(f * 100), pages: 100, key: chapterId, done: f > 0.95 })
  }

  // page mode: a tap on the left or right third, the arrows or the space bar turn one screen
  /** where the text stands one screen further (or back) */
  const screenAt = (dir: 1 | -1) => {
    const el = scroller.current
    if (!el) return 0
    return Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + dir * (el.clientHeight - 48)))
  }
  const turn = (dir: 1 | -1) => {
    const el = scroller.current
    if (!el) return
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
    if (dir > 0 && atEnd) return go(next)
    if (dir < 0 && el.scrollTop <= 0) return go(prev)
    if (curl.current?.turn(dir)) return
    el.scrollBy({ top: dir * (el.clientHeight - 48), behavior: 'smooth' })
  }
  const jump = (dir: 1 | -1) => {
    if (scroller.current) scroller.current.scrollTop = screenAt(dir)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
      if (e.key === 'Escape') return panel ? setPanel(null) : nav(novelPath(src, novelId))
      // pages turn with the arrows and A / D (by key position, so the Russian layout works too)
      const fwd = ['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key) || e.code === 'KeyD'
      const bwd = ['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key) || e.code === 'KeyA'
      if (prefs.paged && fwd) (e.preventDefault(), turn(1))
      else if (prefs.paged && bwd) (e.preventDefault(), turn(-1))
      else if (e.key === 'ArrowRight') go(next)
      else if (e.key === 'ArrowLeft') go(prev)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    const d = document as Doc
    const on = () => setFull(!!(d.fullscreenElement || d.webkitFullscreenElement))
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const toggleFull = () => {
    const d = document as Doc
    if (d.fullscreenElement || d.webkitFullscreenElement) void (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }

  if (!source) return null
  const pct = novel?.chapters.length ? Math.round(((Math.max(0, idx) + frac) / novel.chapters.length) * 100) : 0

  /** the chapter's text; copies of it (the pages being turned) carry no refs */
  const article = (live: boolean) => (
    <article
      className="book mx-auto px-5 sm:px-8"
      style={{
        maxWidth: prefs.width,
        fontFamily: FONTS[prefs.font].css,
        fontSize: prefs.size,
        lineHeight: prefs.leading,
        textAlign: prefs.justify ? 'justify' : 'left',
        paddingTop: 'calc(var(--safe-top) + 84px)',
        paddingBottom: prefs.paged ? '60vh' : 'calc(var(--safe-bottom) + 40px)',
        ['--indent' as string]: prefs.indent ? '1.5em' : '0',
        ['--sub' as string]: paper.sub,
      }}
    >
      <div className="mb-8 text-center text-sm font-bold tracking-wide uppercase" style={{ color: paper.sub, fontFamily: FONTS.sans.css }}>
        {chapter?.title}
      </div>
      <div ref={live ? text : undefined} dangerouslySetInnerHTML={{ __html: shownHtml }} />
      <div className="mt-14 flex flex-col items-center gap-3" style={{ fontFamily: FONTS.sans.css }}>
        {next ? (
          <button onClick={() => go(next)} className="flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 font-bold text-white shadow-xl">
            Следующая глава <ChevronRight size={18} />
          </button>
        ) : (
          <div className="text-sm font-bold" style={{ color: paper.sub }}>
            Это последняя глава
          </div>
        )}
      </div>
    </article>
  )
  const liveScreen = (
  <div
    ref={scroller}
    className={cn('flex-1 overscroll-contain', prefs.paged ? 'overflow-hidden' : 'overflow-y-auto')}
    onScroll={(e) => {
      const el = e.currentTarget
      const f = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 1
      setFrac(f)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => save(f), 700)
      if (el.scrollTop > lastY.current + 40) setUi(false)
      lastY.current = el.scrollTop
    }}
    onWheel={(e) => {
      // a touchpad sends a stream of wheel events for one swipe: one turn per swipe
      if (!prefs.paged || Math.abs(e.deltaY) < 20 || Date.now() - lastWheel.current < 450) return
      lastWheel.current = Date.now()
      turn(e.deltaY > 0 ? 1 : -1)
    }}
    onClick={(e) => {
      if ((e.target as HTMLElement).closest('button, a')) return
      if (window.getSelection()?.toString()) return
      if (prefs.paged) {
        const x = e.clientX / window.innerWidth
        if (x < 0.33) return turn(-1)
        if (x > 0.67) return turn(1)
      }
      setUi((v) => !v)
    }}
  >
      {article(true)}
    </div>
  )

  return (
    <div className="fixed inset-0 z-[70] flex flex-col" style={{ background: paper.bg, color: paper.fg }}>
      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <AlertCircle size={32} className="text-rose-400" />
          <div className="font-bold">Не удалось загрузить главу</div>
          <div className="text-sm opacity-70">{error}</div>
          <button onClick={() => nav(0)} className="mt-2 rounded-full bg-white/10 px-6 py-3 font-bold">
            Ещё раз
          </button>
        </div>
      ) : html === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 size={34} className="animate-spin opacity-60" />
        </div>
      ) : (
        prefs.paged ? (
          <PageCurl
            ref={curl}
            enabled={prefs.curl !== false}
            sound={prefs.flipSound !== false}
            paper={paper.bg}
            canNext={frac < 0.999}
            canPrev={frac > 0.001}
            onNext={() => jump(1)}
            onPrev={() => jump(-1)}
            className="relative min-h-0 flex-1 overflow-hidden"
            render={(at) => (at === 0 ? liveScreen : <ScreenAt top={screenAt(at)}>{article(false)}</ScreenAt>)}
          />
        ) : (
          liveScreen
        )
      )}

      <div
        className={cn('absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/80 to-black/0 px-3 pb-8 text-white transition duration-300 sm:px-5', isElectron && !full && 'sm:pr-[150px]', !ui && !panel && '-translate-y-full opacity-0')}
        style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}
      >
        <IconBtn onClick={() => nav(novelPath(src, novelId))} title="К ранобэ">
          <ArrowLeft size={22} />
        </IconBtn>
        <div className="min-w-0 flex-1">
          <div className="truncate font-extrabold">{novel?.title}</div>
          <div className="truncate text-xs font-semibold text-white/70">
            {chapter?.title} · {pct}%{left && ` · до конца главы ${left}`}
          </div>
        </div>
      </div>

      {/* controls at the bottom, like the manga reader */}
      <div
        className={cn('absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 bg-gradient-to-t from-black/90 via-black/60 to-black/0 px-3 pt-12 text-white transition duration-300 sm:px-5', !ui && !panel && 'translate-y-full opacity-0')}
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
      >
        <div className="flex items-center justify-center gap-1 sm:gap-2">
          <IconBtn onClick={() => setPanel(panel === 'toc' ? null : 'toc')} title="Главы">
            <List size={20} />
          </IconBtn>
          {(foreign || prefs.translate) && (
            <button
              onClick={() => (!hasKey ? setPanel('translate') : setBook({ translate: !prefs.translate }))}
              title={!hasKey ? 'Переводчик' : prefs.translate ? 'Показать оригинал' : 'Перевести на русский'}
              className={cn('flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold transition', translating ? 'bg-accent text-white' : 'hover:bg-white/15')}
            >
              {trBusy ? <Loader2 size={18} className="animate-spin" /> : <Languages size={18} />}
              {!hasKey || !prefs.translate ? 'Перевести' : 'Перевод'}
            </button>
          )}
          <IconBtn onClick={() => setNarrate((v) => !v)} title={narrate ? 'Выключить озвучку' : 'Читать вслух'}>
            <Headphones size={20} className={narrate ? 'text-accent-2' : undefined} />
          </IconBtn>
          <IconBtn onClick={() => setPanel(panel === 'type' ? null : 'type')} title="Шрифт, тема, режим">
            <Type size={20} />
          </IconBtn>
          <IconBtn onClick={toggleFull} title="Во весь экран">
            {full ? <Minimize size={20} /> : <Maximize size={20} />}
          </IconBtn>
        </div>
        <div className="flex items-center gap-3">
          <IconBtn onClick={() => go(prev)} disabled={!prev} title="Предыдущая глава">
            <ChevronLeft size={22} />
          </IconBtn>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-accent-2" style={{ width: `${Math.round(frac * 100)}%` }} />
          </div>
          <span className="shrink-0 text-sm font-bold tabular-nums">
            {idx + 1} / {novel?.chapters.length ?? '…'}
          </span>
          <IconBtn onClick={() => go(next)} disabled={!next} title="Следующая глава">
            <ChevronRight size={22} />
          </IconBtn>
        </div>
      </div>

      {narrate && html !== null && (
        <Narrator
          content={text}
          chapterKey={`${eid}:${chapterId}:${shownRu ? 'ru' : 'src'}`}
          ready={!trBusy}
          onEnd={() => (next ? go(next) : setNarrate(false))}
          close={() => setNarrate(false)}
          onPlaying={setSpeaking}
        />
      )}

      {panel && <div className="absolute inset-0 z-20 bg-black/40" onClick={() => setPanel(null)} />}
      {panel === 'toc' && novel && (
        <Sheet title="Главы" close={() => setPanel(null)}>
          <div className="flex flex-col gap-1">
            {novel.chapters.map((c, i) => (
              <button
                key={c.id}
                ref={c.id === chapterId ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
                onClick={() => (setPanel(null), go(c))}
                className={cn('rounded-xl px-3 py-2.5 text-left text-sm font-bold hover:bg-white/10', c.id === chapterId && 'bg-accent/25 ring-1 ring-accent/50', saved?.read.includes(c.id) && c.id !== chapterId && 'text-white/45')}
              >
                {c.volume && c.volume !== novel.chapters[i - 1]?.volume && <div className="mb-1 text-[11px] text-muted uppercase">{c.volume}</div>}
                {c.title}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {panel === 'type' && <TypeSheet paged prefs={prefs} set={setBook} close={() => setPanel(null)} onTranslator={() => setPanel('translate')} />}
      <SelectionTranslate root={text} enabled={foreign && !shownRu} title={novel?.title ?? ''} keys={tr.geminiKeys} model={tr.geminiModel} />
      {panel === 'translate' && (
        <Sheet title="Переводчик" close={() => setPanel(null)}>
          <TranslatorSetup
            book
            glossary={fileKey(eid)}
            prefs={tr}
            set={setPrefs}
            onSaved={() => {
              setPanel(null)
              setBook({ translate: true })
              setTrTry((t) => t + 1)
            }}
          />
        </Sheet>
      )}
      {translating && (trError || (trBusy && ru?.ch === chapterId && ru.total > 0)) && (
        <button
          onClick={() => trError && setTrTry((t) => t + 1)}
          className={cn('absolute top-20 left-1/2 z-10 -translate-x-1/2 rounded-2xl px-4 py-2 text-center text-sm font-bold text-white shadow-xl', trError ? 'bg-rose-500/90' : 'bg-black/70 backdrop-blur')}
        >
          {trError ? (
            <>
              {trError}
              <div className="text-xs font-semibold opacity-80">Нажмите, чтобы попробовать ещё раз</div>
            </>
          ) : (
            `Перевожу главу… ${ru!.done} / ${ru!.total}`
          )}
        </button>
      )}
    </div>
  )
}

/** a screen of the chapter at a given scroll position: the page under the one being turned */
function ScreenAt({ top, children }: { top: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = top
  }, [top])
  return (
    <div ref={ref} className="flex-1 overflow-hidden">
      {children}
    </div>
  )
}
