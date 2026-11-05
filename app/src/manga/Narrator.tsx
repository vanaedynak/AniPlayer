import { useEffect, useRef, useState, type RefObject } from 'react'
import { Pause, Play, SkipBack, SkipForward, X, Loader2, Moon } from 'lucide-react'
import { blocksOf, linesOf, type Line } from '../lib/narrate'
import { piperPrepare, piperSpeak, voiceCaster, type Voice } from '../lib/piper'
import { f5Ready, f5Speak, f5Voice } from '../lib/f5'
import { isElectron } from '../lib/platform'
import { cn } from '../lib/format'

const RATES = [0.9, 1, 1.15, 1.3, 1.5]
const AHEAD = 3 // lines synthesized ahead of the one playing
/** the sleep timer's steps: minutes, or the end of the chapter */
const SLEEP: (number | 'chapter' | null)[] = [null, 15, 30, 60, 'chapter']

/**
 * Reads the chapter aloud line by line, each character in their own voice, highlighting the paragraph
 * being read. At the end of the chapter it turns to the next one and goes on.
 */
export function Narrator({
  content,
  chapterKey,
  ready,
  onEnd,
  close,
  onPlaying,
}: {
  /** the element holding the chapter text */
  content: RefObject<HTMLDivElement | null>
  /** changes with the chapter: reading starts over from its top */
  chapterKey: string
  /** the text is final (a translation may still be arriving) */
  ready: boolean
  onEnd: () => void
  close: () => void
  /** reading or paused, for keeping the screen on only while it reads */
  onPlaying?: (playing: boolean) => void
}) {
  const [playing, setPlaying] = useState(true)
  // sleep timer: stops reading at a set time or at the end of the chapter, the screen then goes dark by itself
  const [sleep, setSleep] = useState<{ step: number; until: number | null }>({ step: 0, until: null })
  const sleepRef = useRef(sleep)
  sleepRef.current = sleep
  const [, tick] = useState(0)
  useEffect(() => onPlaying?.(playing), [playing, onPlaying])
  useEffect(() => {
    if (!sleep.until) return
    const t = setInterval(() => {
      if (Date.now() >= sleep.until!) {
        setPlaying(false)
        setSleep({ step: 0, until: null })
      } else tick((n) => n + 1)
    }, 5000)
    return () => clearInterval(t)
  }, [sleep.until])
  const nextSleep = () => {
    const step = (sleep.step + 1) % SLEEP.length
    const v = SLEEP[step]
    setSleep({ step, until: typeof v === 'number' ? Date.now() + v * 60_000 : null })
    if (v) setPlaying(true)
  }
  const sleepLabel = (() => {
    const v = SLEEP[sleep.step]
    if (v === 'chapter') return 'до конца главы'
    if (!sleep.until) return ''
    return `${Math.max(1, Math.ceil((sleep.until - Date.now()) / 60_000))} мин`
  })()
  const [idx, setIdx] = useState(-1)
  const [busy, setBusy] = useState('')
  const [rate, setRate] = useState(() => Number(localStorage.getItem('aniplayer-narrator-rate')) || 1)
  // on the PC the F5 module reads when it is installed; Piper everywhere else and as the fallback
  const [engine, setEngine] = useState<'f5' | 'piper'>(() => {
    const saved = localStorage.getItem('aniplayer-narrator-engine')
    return saved === 'f5' || (isElectron && saved !== 'piper') ? 'f5' : 'piper'
  })
  const [f5, setF5] = useState<boolean | null>(null)
  useEffect(() => {
    if (engine !== 'f5') return
    let alive = true
    setBusy('Запускаю голосовой модуль…')
    void f5Ready().then((ok) => {
      if (!alive) return
      setF5(ok)
      setBusy('')
      if (!ok) setEngine('piper')
    })
    return () => {
      alive = false
    }
  }, [engine])
  const useF5 = engine === 'f5' && f5 === true
  const audio = useRef<HTMLAudioElement | null>(null)
  const lines = useRef<Line[]>([])
  const blocks = useRef<HTMLElement[]>([])
  const voices = useRef<{ line: Line; voice: Voice }[]>([])
  const cache = useRef(new Map<number, Promise<string>>())
  const first = useRef(true)

  // lay the chapter out into lines once its text is final; the first chapter starts where the reader is
  useEffect(() => {
    if (!ready || !content.current) return
    for (const u of cache.current.values()) void u.then(URL.revokeObjectURL).catch(() => {})
    cache.current.clear()
    blocks.current = blocksOf(content.current)
    lines.current = linesOf(blocks.current.map((b) => (b.textContent ?? '').replace(/\u00AD/g, '')))
    const cast = voiceCaster()
    voices.current = lines.current.map((line) => ({ line, voice: cast(line.role, line.who) }))
    // every voice of the chapter downloads now, not in the middle of a dialogue
    if (engine === 'piper') for (const id of new Set(voices.current.map((v) => v.voice.id))) piperPrepare(id, (_, part) => part < 1 && setBusy(`Скачиваю голоса… ${Math.round(part * 100)}%`))
    let start = 0
    if (first.current) {
      const top = 90
      const b = blocks.current.findIndex((el) => el.getBoundingClientRect().bottom > top)
      start = Math.max(0, lines.current.findIndex((l) => l.block >= b))
    }
    first.current = false
    setIdx(lines.current.length ? start : -1)
    if (!lines.current.length) onEnd()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterKey, ready])

  const synth = (i: number) => {
    const v = voices.current[i]
    if (!v) return null
    let p = cache.current.get(i)
    if (!p) {
      p = (useF5 ? f5Speak(v.line.text, f5Voice(v.voice.role, v.voice.n)) : piperSpeak(v.line.text, v.voice, (_, part) => setBusy(`Скачиваю голос… ${Math.round(part * 100)}%`))).then((b) =>
        URL.createObjectURL(b),
      )
      cache.current.set(i, p)
      p.catch(() => cache.current.delete(i))
    }
    return p
  }

  // highlight the paragraph being read and keep it in view
  useEffect(() => {
    const line = lines.current[idx]
    if (!line) return
    const el = blocks.current[line.block]
    el?.classList.add('narrating')
    const r = el?.getBoundingClientRect()
    if (r && (r.top < 80 || r.bottom > innerHeight - 140)) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return () => el?.classList.remove('narrating')
  }, [idx])

  // play the current line, prepare the next ones meanwhile
  useEffect(() => {
    if (idx < 0 || !playing || (engine === 'f5' && f5 === null)) return
    let alive = true
    const p = synth(idx)
    for (let k = 1; k <= AHEAD; k++) synth(idx + k)
    if (!p) return
    setBusy((b) => b || 'Готовлю голос…')
    p.then((url) => {
      if (!alive) return
      setBusy('')
      const a = (audio.current ??= new Audio())
      const v = voices.current[idx].voice
      const pitch = useF5 ? 1 : v.pitch
      a.src = url
      a.preservesPitch = pitch === 1
      a.playbackRate = rate * pitch
      a.onended = () => {
        if (!alive) return
        if (idx + 1 < lines.current.length) setIdx(idx + 1)
        else if (SLEEP[sleepRef.current.step] === 'chapter') {
          // the timer said "to the end of the chapter": stop here, the next one waits
          setPlaying(false)
          setSleep({ step: 0, until: null })
        } else onEnd()
      }
      void a.play().catch(() => setPlaying(false))
    }).catch((e) => alive && setBusy(`Не получилось озвучить: ${e?.message ?? e}`))
    return () => {
      alive = false
      audio.current?.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, playing, rate, useF5, f5])

  // another engine: the lines ahead are made again in its voices
  useEffect(() => {
    for (const u of cache.current.values()) void u.then(URL.revokeObjectURL).catch(() => {})
    cache.current.clear()
  }, [useF5])

  useEffect(
    () => () => {
      audio.current?.pause()
      for (const u of cache.current.values()) void u.then(URL.revokeObjectURL).catch(() => {})
    },
    [],
  )

  const step = (d: number) => setIdx((i) => Math.min(lines.current.length - 1, Math.max(0, i + d)))
  const setSpeed = (r: number) => {
    setRate(r)
    try {
      localStorage.setItem('aniplayer-narrator-rate', String(r))
    } catch {
      /* ignore */
    }
  }
  const line = lines.current[idx]
  const who = line ? (line.role === 'narrator' ? 'Рассказчик' : `${line.who?.replace(/#\d+$/, '') || (line.role === 'f' ? 'Она' : 'Он')}`) : ''

  return (
    <div
      className="absolute inset-x-3 bottom-20 z-20 mx-auto flex max-w-xl items-center gap-2 rounded-full bg-black/80 p-1.5 pl-4 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur"
      style={{ marginBottom: 'var(--safe-bottom)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="min-w-0 flex-1 text-xs font-semibold">
        <div className="truncate font-extrabold">{busy || (line ? who : 'Озвучка')}</div>
        {!busy && line && <div className="truncate text-white/60">{line.text}</div>}
      </div>
      <button onClick={() => step(-1)} title="Назад" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10">
        <SkipBack size={17} />
      </button>
      <button onClick={() => setPlaying((p) => !p)} title={playing ? 'Пауза' : 'Читать'} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black">
        {busy && playing && !busy.startsWith('Не') ? <Loader2 size={18} className="animate-spin" /> : playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <button onClick={() => step(1)} title="Дальше" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10">
        <SkipForward size={17} />
      </button>
      <button
        onClick={nextSleep}
        title={sleep.step ? `Таймер сна: ${sleepLabel}. Нажмите, чтобы изменить` : 'Таймер сна: остановить чтение через 15 / 30 / 60 минут или в конце главы'}
        className={cn('flex h-9 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-extrabold hover:bg-white/10', sleep.step > 0 && 'text-accent-2')}
      >
        <Moon size={15} />
        {sleep.step ? <span className="max-w-24 truncate">{sleepLabel}</span> : null}
      </button>
      <button
        onClick={() => setSpeed(RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1)}
        title="Скорость"
        className={cn('h-9 min-w-12 rounded-full px-2 text-xs font-extrabold tabular-nums hover:bg-white/10', rate !== 1 && 'text-accent-2')}
      >
        {rate}×
      </button>
      {(isElectron || f5) && (
        <button
          onClick={() => {
            const next = engine === 'f5' ? 'piper' : 'f5'
            setEngine(next)
            try {
              localStorage.setItem('aniplayer-narrator-engine', next)
            } catch {
              /* ignore */
            }
          }}
          title={engine === 'f5' ? 'Живые голоса F5 (видеокарта). Нажмите для Piper' : f5 === false ? 'Голосовой модуль F5 не установлен' : 'Piper. Нажмите для живых голосов F5'}
          className={cn('h-9 rounded-full px-2.5 text-xs font-extrabold hover:bg-white/10', useF5 && 'text-accent-2')}
        >
          {engine === 'f5' ? 'F5' : 'Piper'}
        </button>
      )}
      <button onClick={close} title="Выключить озвучку" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10">
        <X size={17} />
      </button>
    </div>
  )
}
