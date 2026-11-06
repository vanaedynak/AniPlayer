import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, List, Type, Maximize, Minimize, Loader2, AlertCircle, Languages, Headphones } from 'lucide-react'
import { openBook, useBooks, type Parsed } from './books'
import { useManga } from './store'
import { PAPER } from './ui'
import { Sheet, IconBtn, TranslatorSetup } from './Reader'
import { FONTS } from '../read/bookLook'
import { BookSheet } from '../read/ReadingSheet'
import { BookPages, type BookHandle } from '../read/BookPages'
import { AmbienceLayer, useAmbientSound } from '../read/Ambience'
import { isRussian, savedChapter, translateChapter } from './bookTranslate'
import { DEFAULT_MODEL } from './translate'
import { cn } from '../lib/format'
import { Narrator } from './Narrator'
import { isElectron } from '../lib/platform'
import { useReaderSession } from '../lib/power'
import { useReadingClock } from '../lib/activity'
import { awayAfter, minutesLeft, usePresence, useTextPace, wordCount } from '../lib/reading'
import { SelectionTranslate } from './SelectionTranslate'

type Doc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
type El = HTMLElement & { webkitRequestFullscreen?: () => void }

export { FONTS }

export default function BookReader() {
  const { id = '' } = useParams()
  useReadingClock()
  useReaderSession()
  const nav = useNavigate()
  const book = useBooks((s) => s.books[id])
  const position = useBooks((s) => s.position)
  const prefs = useManga((s) => s.book)
  const setBook = useManga((s) => s.setBook)
  const tr = useManga((s) => s.prefs)
  const setPrefs = useManga((s) => s.setPrefs)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [error, setError] = useState('')
  const [chapter, setChapter] = useState(book?.chapter ?? 0)
  const [ui, setUi] = useState(true)
  const [panel, setPanel] = useState<null | 'toc' | 'type' | 'translate'>(null)
  const [full, setFull] = useState(false)
  const [frac, setFrac] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [narrate, setNarrate] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const restore = useRef(book?.frac ?? 0)
  const lastY = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const paper = PAPER[prefs.paper] ?? PAPER.dark
  const paged = prefs.paged !== false
  const bookRef = useRef<BookHandle>(null)
  const [start, setStart] = useState(book?.frac ?? 0)
  const [pageInfo, setPageInfo] = useState<{ page: number; count: number } | null>(null)
  useAmbientSound()

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

  // translation: the current chapter (shown batch by batch as it arrives), then the next one in advance
  const hasKey = tr.geminiKeys.some((k) => k.trim())
  const source = parsed?.chapters[Math.min(chapter, count - 1)]
  const foreign = !!source && !isRussian(source.html)
  const translating = prefs.translate && foreign && hasKey
  const [ru, setRu] = useState<{ chapter: number; html: string; done: number; total: number } | null>(null)
  const [trError, setTrError] = useState('')
  const [trTry, setTrTry] = useState(0)
  useEffect(() => {
    if (!translating || !parsed || !source) return
    let alive = true
    setTrError('')
    const ctx = { keys: tr.geminiKeys, model: tr.geminiModel || DEFAULT_MODEL, title: parsed.title || book?.title || '' }
    void savedChapter(id, chapter).then((hit) => {
      if (!alive) return
      if (hit) setRu({ chapter, html: hit, done: 1, total: 1 })
      else setRu({ chapter, html: '', done: 0, total: 0 })
      translateChapter(id, chapter, source.html, ctx, (html, done, total) => alive && setRu({ chapter, html, done, total }))
        .then((html) => {
          if (!alive) return
          setRu({ chapter, html, done: 1, total: 1 })
          const next = parsed.chapters[chapter + 1]
          if (next && !isRussian(next.html)) void translateChapter(id, chapter + 1, next.html, ctx).catch(() => {})
        })
        .catch((e) => alive && setTrError(String(e?.message ?? e)))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translating, parsed, chapter, id, tr.geminiKeys, tr.geminiModel, trTry])
  const shownRu = translating && ru?.chapter === chapter && ru.html ? ru : null
  const trBusy = translating && !trError && (!ru || ru.chapter !== chapter || ru.done < ru.total || !ru.html)

  // the screen stays on while someone reads or listens; their pace says how long the chapter has left
  const present = usePresence(awayAfter(80), narrate && speaking)
  const shownHtml = shownRu?.html || source?.html || ''
  const words = useMemo(() => wordCount(shownHtml.replace(/<[^>]+>/g, ' ')), [shownHtml])
  const wpm = useTextPace(words, frac, present)
  const left = minutesLeft(((words * (1 - frac)) / wpm) * 60)
  const goChapter = (i: number, fromEnd = false) => {
    if (i < 0 || i >= count) return
    setChapter(i)
    setFrac(fromEnd ? 1 : 0)
    setStart(fromEnd ? 1 : 0)
    position(id, i, fromEnd ? 1 : 0)
    scroller.current?.scrollTo({ top: 0 })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return
      if (e.key === 'Escape') return panel ? setPanel(null) : nav('/ranobe/files')
      const fwd = ['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key) || e.code === 'KeyD'
      const bwd = ['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key) || e.code === 'KeyA'
      if (paged && (fwd || bwd)) {
        e.preventDefault()
        bookRef.current?.turn(fwd ? 1 : -1)
        return
      }
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
        <button onClick={() => nav('/ranobe/files')} className="rounded-full bg-white/10 px-6 py-3 font-bold">
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
      ) : paged ? (
        <div className="relative flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
          <BookPages
            ref={bookRef}
            html={shownRu?.html || ch.html}
            chapterTitle={ch.title}
            bookTitle={parsed?.title || book.title}
            prefs={prefs}
            paper={paper}
            chapterKey={`${chapter}:${shownRu ? 'ru' : 'src'}`}
            start={start}
            bookBefore={chapter / Math.max(1, count)}
            bookShare={1 / Math.max(1, count)}
            hasNext={chapter < count - 1}
            hasPrev={chapter > 0}
            onNext={() => goChapter(chapter + 1)}
            onPrev={() => goChapter(chapter - 1, true)}
            onPage={(pg, n) => {
              const f = n > 1 ? pg / (n - 1) : 1
              setPageInfo({ page: pg, count: n })
              setFrac(f)
              setStart(f)
              clearTimeout(saveTimer.current)
              saveTimer.current = setTimeout(() => position(id, chapter, f), 600)
              if (pg > 0) setUi(false)
            }}
            onTap={() => setUi((v) => !v)}
            textRef={text}
            end={
              chapter < count - 1 ? (
                <button onClick={() => goChapter(chapter + 1)} className="flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 font-bold text-white shadow-xl">
                  Следующая глава <ChevronRight size={18} />
                </button>
              ) : (
                <div className="font-bold">Конец книги</div>
              )
            }
          />
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
              fontFamily: (FONTS[prefs.font] ?? FONTS.literata).css,
              fontWeight: prefs.weight ?? 400,
              ['--para' as string]: `${prefs.para ?? 0.3}em`,
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
            <div ref={text} dangerouslySetInnerHTML={{ __html: shownRu?.html || ch.html }} />
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

      <AmbienceLayer dark={paper.dark} />

      <div
        className={cn('absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/80 to-black/0 px-3 pb-8 text-white transition duration-300 sm:px-5', isElectron && !full && 'sm:pr-[150px]', !ui && !panel && '-translate-y-full opacity-0')}
        style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}
      >
        <IconBtn onClick={() => nav('/ranobe/files')} title="К книгам">
          <ArrowLeft size={22} />
        </IconBtn>
        <div className="min-w-0 flex-1">
          <div className="truncate font-extrabold">{book.title}</div>
          <div className="truncate text-xs font-semibold text-white/70">
            {ch?.title} · {total}%{left && ` · до конца главы ${left}`}
          </div>
        </div>
        {(foreign || prefs.translate) && (
          <button
            onClick={() => {
              if (!hasKey) setPanel('translate')
              else setBook({ translate: !prefs.translate })
            }}
            title={!hasKey ? 'Переводчик' : prefs.translate ? 'Показать оригинал' : 'Перевести на русский'}
            className={cn('flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold transition', translating ? 'bg-accent text-white' : 'bg-white/10 hover:bg-white/20')}
          >
            {trBusy ? <Loader2 size={17} className="animate-spin" /> : <Languages size={17} />}
            <span className="hidden sm:inline">{!hasKey || !prefs.translate ? 'Перевести' : 'Перевод'}</span>
          </button>
        )}
        <IconBtn onClick={() => setNarrate((v) => !v)} title={narrate ? 'Выключить озвучку' : 'Читать вслух'}>
          <Headphones size={20} className={narrate ? 'text-accent-2' : undefined} />
        </IconBtn>
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
        <div className="min-w-0 flex-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-accent-2" style={{ width: `${total}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] font-bold text-white/60 tabular-nums">
            <span>{paged && pageInfo ? `стр. ${pageInfo.page + 1} из ${pageInfo.count}` : `${total}%`}</span>
            <span>
              глава {Math.min(chapter + 1, count)} из {count}
            </span>
          </div>
        </div>
        <IconBtn onClick={() => goChapter(chapter + 1)} disabled={chapter >= count - 1} title="Следующая глава">
          <ChevronRight size={22} />
        </IconBtn>
      </div>

      {narrate && ch && (
        <Narrator
          content={text}
          chapterKey={`${id}:${chapter}:${shownRu ? 'ru' : 'src'}`}
          ready={!trBusy}
          onEnd={() => (chapter < count - 1 ? goChapter(chapter + 1) : setNarrate(false))}
          close={() => setNarrate(false)}
          onPlaying={setSpeaking}
        />
      )}
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
      {panel === 'type' && <BookSheet prefs={prefs} set={setBook} close={() => setPanel(null)} onTranslator={() => setPanel('translate')} />}
      <SelectionTranslate root={text} enabled={foreign && !shownRu} title={parsed?.title || book.title || ''} keys={tr.geminiKeys} model={tr.geminiModel} />
      {panel === 'translate' && (
        <Sheet title="Переводчик" close={() => setPanel(null)}>
          <TranslatorSetup
            book
            glossary={id}
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
      {translating && (trError || (trBusy && ru?.chapter === chapter && ru.total > 0)) && (
        <button
          onClick={() => trError && setTrTry((t) => t + 1)}
          className={cn(
            'absolute bottom-24 left-1/2 z-10 -translate-x-1/2 rounded-2xl px-4 py-2 text-center text-sm font-bold text-white shadow-xl',
            trError ? 'bg-rose-500/90' : 'bg-black/70 backdrop-blur',
          )}
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
