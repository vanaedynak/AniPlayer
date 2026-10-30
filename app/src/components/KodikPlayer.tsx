import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import {
  FastForward,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  RotateCw,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  Loader2,
  MousePointerClick,
} from 'lucide-react'
import { aniskip, type Release } from '../lib/api'
import { kodikCommand } from '../lib/kodik'
import type { Seg } from '../lib/yummy'
import { useStore, getProgress, WATCHED_RATIO } from '../lib/store'
import { waitForFirstSync } from '../lib/sync'
import { anilistReportEpisode } from '../lib/anilist'
import { onAppHide, isIOS } from '../lib/platform'
import { fmtTime, cn } from '../lib/format'
import { useRoomPlayback } from './Room'
import { useRoom } from '../lib/room'

const AUTO_SKIP_MS = 5000
// Kodik plays an ad or refuses a scripted start: after this long without progress we hand control to its own UI
const STALL_MS = 4000

/** an embedded player (Kodik and friends) wired into our progress, history, stats and auto-skip.
 *  Kodik is driven through its postMessage API with our own controls on top;
 *  other players (and Kodik during ads) are used with their own controls. */
export default function KodikPlayer({
  release,
  src,
  episode,
  op,
  ed,
  hasNext,
  onNext,
}: {
  release: Release
  src: string
  episode: number
  op?: Seg
  ed?: Seg
  hasNext: boolean
  onNext: () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const st = useRef({ time: 0, duration: 0, playing: false, played: 0, pendingWatch: 0, lastSave: 0, resumed: false, reported: false, skippedOp: false, skippedEd: false, lastTick: 0 })
  const [skip, setSkip] = useState<{ op?: Seg; ed?: Seg }>({})
  const [autoSkip, setAutoSkip] = useState<{ kind: 'op' | 'ed'; left: number } | null>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [toast, setToast] = useState('')
  const [playing, setPlaying] = useState(false)
  const [wantPlay, setWantPlay] = useState(false)
  const [started, setStarted] = useState(false)
  const [nextIn, setNextIn] = useState<number | null>(null)
  // 'auto': handed over for an ad / first tap and taken back by itself; 'manual': the user asked for Kodik's menus
  const [native, setNative] = useState<false | 'auto' | 'manual'>(false)
  const [controls, setControls] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [volume, setVol] = useState<{ volume: number; muted: boolean }>({ volume: useStore.getState().local.volume, muted: false })
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [ripple, setRipple] = useState<{ side: 'l' | 'r'; id: number; secs: number } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const malId = release.mal?.id
  const isKodik = /kodik/.test(src)
  const ours = isKodik && !native

  const save = useCallback(
    (force = false) => {
      const s = st.current
      if (s.played < 3 || !s.duration) return
      useStore
        .getState()
        .saveProgress({ releaseId: release.id, ordinal: episode, time: s.time, duration: s.duration, watched: false }, force)
      if (s.pendingWatch > 0) {
        useStore.getState().addWatchTime(s.pendingWatch)
        s.pendingWatch = 0
      }
    },
    [release.id, episode],
  )

  useEffect(() => onAppHide(() => save(true)), [save])

  // reset per episode; save the previous one on the way out
  useEffect(() => {
    st.current = { time: 0, duration: 0, playing: false, played: 0, pendingWatch: 0, lastSave: 0, resumed: false, reported: false, skippedOp: false, skippedEd: false, lastTick: 0 }
    setAutoSkip(null)
    setNextIn(null)
    setTime(0)
    setDuration(0)
    setPlaying(false)
    setStarted(false)
    setNative(false)
    if (op || ed) setSkip({ op, ed })
    else {
      setSkip({})
      if (malId) aniskip(malId, episode).then(setSkip)
    }
    return () => save(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, malId, save])

  const cmd = useCallback((method: string, extra?: Record<string, unknown>) => kodikCommand(frameRef.current, method, extra), [])
  const seek = useCallback(
    (t: number) => {
      const d = st.current.duration
      const to = Math.max(0, d ? Math.min(d - 1, t) : t)
      cmd('seek', { seconds: to })
      st.current.time = to
      setTime(to)
      setTimeout(() => reportRef.current(), 50)
    },
    [cmd],
  )

  // watch together: Kodik's clock is our clock; play/pause go through its API
  const report = useRoomPlayback(
    {
      time: () => st.current.time,
      playing: () => st.current.playing,
      play: () => {
        cmd('play')
        setWantPlay(true)
      },
      pause: () => {
        cmd('pause')
        setWantPlay(false)
        st.current.playing = false
        setPlaying(false)
      },
      seek,
    },
    duration > 0,
  )
  const reportRef = useRef(report)
  reportRef.current = report
  useEffect(() => reportRef.current(), [playing])

  const markWatched = useCallback(() => {
    const s = st.current
    if (s.reported) return
    s.reported = true
    useStore.getState().setWatched(release.id, episode, true, s.duration)
    void anilistReportEpisode(malId, episode)
  }, [release.id, episode, malId])

  const resume = useCallback(async () => {
    const s = st.current
    if (s.resumed) return
    s.resumed = true
    if (useRoom.getState().code) return
    await waitForFirstSync()
    const p = getProgress(release.id, episode)
    if (p && !p.watched && p.time > 5 && (!p.duration || p.time < p.duration - 15)) {
      seek(p.time)
      setToast(`Продолжаем с ${fmtTime(p.time)}`)
    }
  }, [release.id, episode, seek])

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return
      const { key, value } = (e.data ?? {}) as { key?: string; value?: unknown }
      const s = st.current
      if (key === 'kodik_player_duration_update' && typeof value === 'number') {
        s.duration = value
        setDuration(value)
      } else if (key === 'kodik_player_play' || key === 'kodik_player_video_started') {
        s.playing = true
        setPlaying(true)
        setStarted(true)
        void resume()
      } else if (key === 'kodik_player_pause') {
        s.playing = false
        setPlaying(false)
        save(true)
      } else if (key === 'kodik_player_volume_change' && value && typeof value === 'object') {
        const v = value as { volume?: number; muted?: boolean }
        setVol({ volume: v.volume ?? 1, muted: !!v.muted })
      } else if ((key === 'kodik_player_time_update' || key === 'kodik_player_time') && typeof value === 'number') {
        const d = value - s.time
        // Kodik only announces play/pause for clicks inside it, so a moving clock is the real "playing" signal
        if (d > 0.05 && d < 3) {
          s.lastTick = Date.now()
          if (!s.playing) {
            s.playing = true
            setPlaying(true)
            setStarted(true)
            void resume()
          }
          s.played += d
          s.pendingWatch += d
        }
        s.time = value
        setTime(value)
        if (Date.now() - s.lastSave > 2000) {
          s.lastSave = Date.now()
          save()
        }
        if (s.duration && (value / s.duration >= WATCHED_RATIO || (skip.ed && value >= skip.ed.start))) markWatched()
      } else if (key === 'kodik_player_seek') save(true)
      else if (key === 'kodik_player_video_ended') {
        save(true)
        markWatched()
        s.playing = false
        setPlaying(false)
        if (hasNext && useStore.getState().prefs.autoNext) setNextIn(5)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [save, markWatched, hasNext, skip.ed, resume])

  // the clock is also polled: a stopped clock means paused (or buffering, or an ad)
  useEffect(() => {
    const t = setInterval(() => {
      cmd('get_time')
      const s = st.current
      if (s.playing && Date.now() - s.lastTick > 1800) {
        s.playing = false
        setPlaying(false)
      }
    }, 700)
    return () => clearInterval(t)
  }, [src, cmd])

  // we asked to play but nothing moves: an ad is running or the device wants a tap inside the player itself
  useEffect(() => {
    if (!ours || !wantPlay || playing) return
    const t = setTimeout(() => {
      setNative('auto')
      setToast(started ? 'Реклама или загрузка — управление у плеера Kodik' : 'Нажмите ▶ в плеере, дальше управление снова наше')
    }, STALL_MS)
    return () => clearTimeout(t)
  }, [ours, wantPlay, playing, started])

  // once the video really runs again after an ad / manual start, our controls come back
  useEffect(() => {
    if (native === 'auto' && isKodik && playing && st.current.played > 1) {
      const t = setTimeout(() => setNative(false), 1500)
      return () => clearTimeout(t)
    }
  }, [native, isKodik, playing])

  const togglePlay = useCallback(() => {
    if (st.current.playing) {
      cmd('pause')
      setWantPlay(false)
      st.current.playing = false
      setPlaying(false)
      save(true)
    } else {
      cmd('play')
      setWantPlay(true)
    }
  }, [cmd, save])

  const seekBy = useCallback((d: number) => seek(st.current.time + d), [seek])

  const setVolume = (v: number) => {
    const volumeNow = Math.max(0, Math.min(1, v))
    cmd('volume', { volume: volumeNow })
    if (volumeNow > 0 && volume.muted) cmd('unmute')
    setVol({ volume: volumeNow, muted: false })
    useStore.getState().setLocal({ volume: volumeNow })
  }
  const toggleMute = () => {
    cmd(volume.muted ? 'unmute' : 'mute')
    setVol((v) => ({ ...v, muted: !v.muted }))
  }

  // our wrapper goes fullscreen (not the iframe) so the controls stay on top
  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (doc.exitFullscreen) void doc.exitFullscreen()
      else doc.webkitExitFullscreen?.()
    } else if (el?.requestFullscreen) void el.requestFullscreen().catch(() => {})
    else el?.webkitRequestFullscreen?.()
  }, [])

  useEffect(() => {
    const on = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element }
      setFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement))
    }
    document.addEventListener('fullscreenchange', on)
    document.addEventListener('webkitfullscreenchange', on)
    return () => {
      document.removeEventListener('fullscreenchange', on)
      document.removeEventListener('webkitfullscreenchange', on)
    }
  }, [])

  // ---------- controls visibility ----------
  const poke = useCallback(() => {
    setControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => st.current.playing && setControls(false), 2800)
  }, [])
  useEffect(() => {
    if (!playing) setControls(true)
    else poke()
  }, [playing, poke])

  // ---------- auto-skip: offer "watch opening" for 5 seconds, then skip ----------
  const prefs = useStore((s) => s.prefs)
  const inOp = !!skip.op && time >= skip.op.start && time < skip.op.stop - 1
  const inEd = !!skip.ed && time >= skip.ed.start && time < skip.ed.stop - 1
  useEffect(() => {
    const s = st.current
    if (skip.op && time < skip.op.start - 1) s.skippedOp = false
    if (skip.ed && time < skip.ed.start - 1) s.skippedEd = false
    if (inOp && prefs.autoSkipOpening && !s.skippedOp) {
      s.skippedOp = true
      setAutoSkip({ kind: 'op', left: AUTO_SKIP_MS })
    } else if (inEd && prefs.autoSkipEnding && !s.skippedEd) {
      s.skippedEd = true
      setAutoSkip({ kind: 'ed', left: AUTO_SKIP_MS })
    }
    setAutoSkip((a) => (a && ((a.kind === 'op' && !inOp) || (a.kind === 'ed' && !inEd)) ? null : a))
  }, [time, inOp, inEd, skip, prefs.autoSkipOpening, prefs.autoSkipEnding])

  useEffect(() => {
    if (!autoSkip || !playing) return
    if (autoSkip.left <= 0) {
      setAutoSkip(null)
      if (autoSkip.kind === 'op' && skip.op) {
        seek(skip.op.stop)
        setToast('Опенинг пропущен')
      } else if (autoSkip.kind === 'ed' && skip.ed) {
        if (hasNext && prefs.autoNext) onNext()
        else seek(skip.ed.stop)
      }
      return
    }
    let last = performance.now()
    const t = setInterval(() => {
      const now = performance.now()
      const dt = now - last
      last = now
      setAutoSkip((a) => (a ? { ...a, left: a.left - dt } : a))
    }, 100)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSkip, playing])

  useEffect(() => {
    if (nextIn == null) return
    if (nextIn <= 0) {
      setNextIn(null)
      onNext()
      return
    }
    const t = setTimeout(() => setNextIn((n) => (n == null ? null : n - 1)), 1000)
    return () => clearTimeout(t)
  }, [nextIn, onNext])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 5000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!ripple) return
    const t = setTimeout(() => setRipple(null), 700)
    return () => clearTimeout(t)
  }, [ripple])

  // ---------- keyboard (same keys as our own player) ----------
  useEffect(() => {
    if (!ours) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === ' ' || k === 'k' || k === 'л') togglePlay()
      else if (k === 'arrowleft') seekBy(-5)
      else if (k === 'arrowright') seekBy(5)
      else if (k === 'j' || k === 'о') seekBy(-10)
      else if (k === 'l' || k === 'д') seekBy(10)
      else if (k === 'arrowup') setVolume(volume.volume + 0.05)
      else if (k === 'arrowdown') setVolume(volume.volume - 0.05)
      else if (k === 'f' || k === 'а') toggleFullscreen()
      else if (k === 'm' || k === 'ь') toggleMute()
      else if ((k === 'n' || k === 'т') && hasNext) onNext()
      else if (/^[0-9]$/.test(k) && duration) seek((duration * Number(k)) / 10)
      else return
      e.preventDefault()
      poke()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---------- gestures: click = play/pause, double click = fullscreen, double tap on a side = ±10s ----------
  const lastTap = useRef({ t: 0, x: 0 })
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onSurfaceUp = (e: RPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const now = Date.now()
    const isDouble = now - lastTap.current.t < 300 && Math.abs(x - lastTap.current.x) < 80
    lastTap.current = { t: now, x }
    clearTimeout(tapTimer.current)
    if (e.pointerType === 'mouse') {
      if (isDouble) toggleFullscreen()
      else tapTimer.current = setTimeout(togglePlay, 220)
      return
    }
    if (isDouble && x < rect.width * 0.38) {
      seekBy(-10)
      setRipple((r) => ({ side: 'l', id: now, secs: r?.side === 'l' ? r.secs + 10 : 10 }))
    } else if (isDouble && x > rect.width * 0.62) {
      seekBy(10)
      setRipple((r) => ({ side: 'r', id: now, secs: r?.side === 'r' ? r.secs + 10 : 10 }))
    } else
      tapTimer.current = setTimeout(() => {
        if (!started) togglePlay()
        else if (controls && playing) setControls(false)
        else poke()
      }, 250)
  }

  // ---------- seek bar ----------
  const posFromEvent = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    return { x: ratio * r.width, t: ratio * (duration || 0) }
  }
  const shownTime = scrub ?? time
  const pct = (t: number) => (duration ? (t / duration) * 100 : 0)
  const VolumeIcon = volume.muted || volume.volume === 0 ? VolumeX : volume.volume < 0.5 ? Volume1 : Volume2
  const showControls = controls || !playing

  return (
    <div
      ref={wrapRef}
      className={cn(
        'group/player relative w-full overflow-hidden bg-black select-none',
        fullscreen ? 'h-full' : 'aspect-video rounded-3xl shadow-2xl shadow-black/60 ring-1 ring-white/5',
        ours && !showControls && 'cursor-none',
      )}
      onPointerMove={(e) => ours && e.pointerType === 'mouse' && poke()}
      onMouseLeave={() => ours && playing && setControls(false)}
    >
      <iframe
        ref={frameRef}
        key={src}
        src={src}
        className="absolute inset-0 h-full w-full"
        allow="autoplay *; fullscreen *; picture-in-picture *; encrypted-media *"
        allowFullScreen
        referrerPolicy="origin"
        title="Kodik"
      />

      {ours && (
        <>
          {/* everything the mouse does lands here, so Kodik's own overlay never shows up */}
          <div className="absolute inset-0" onPointerUp={onSurfaceUp} />
          <div
            className={cn(
              'pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40 transition-opacity duration-300',
              !started ? 'bg-black/35 opacity-100' : showControls ? 'opacity-100' : 'opacity-0',
            )}
          />

          {ripple && (
            <div
              key={ripple.id}
              className={cn(
                'pointer-events-none absolute top-0 bottom-0 flex w-2/5 items-center justify-center',
                ripple.side === 'l' ? 'left-0 rounded-r-[50%]' : 'right-0 rounded-l-[50%]',
              )}
            >
              <div className="animate-ripple absolute inset-0 bg-white/10" />
              <div className="animate-fade-in flex flex-col items-center gap-1 text-sm font-semibold">
                {ripple.side === 'l' ? <RotateCcw size={30} /> : <RotateCw size={30} />}
                {ripple.secs} сек
              </div>
            </div>
          )}

          {wantPlay && !playing && nextIn == null && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <Loader2 className="animate-spin text-white/90" size={54} strokeWidth={2.2} />
            </div>
          )}

          {!wantPlay && !playing && nextIn == null && (
            <button
              className="animate-pop absolute top-1/2 left-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-black shadow-2xl transition hover:scale-105"
              onClick={togglePlay}
              aria-label="Смотреть"
            >
              <Play size={34} fill="currentColor" className="ml-1" />
            </button>
          )}

          <div
            className={cn(
              'absolute inset-x-0 bottom-0 px-3 pb-3 transition-all duration-300 sm:px-5 sm:pb-5',
              showControls ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
            )}
          >
            <div className="mb-3 flex items-end justify-between gap-2">
              <div className="glass flex items-center gap-0.5 rounded-2xl p-1.5 ring-1 ring-white/10">
                <button
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-black transition hover:scale-105"
                  onClick={togglePlay}
                  aria-label={playing ? 'Пауза' : 'Смотреть'}
                >
                  {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
                </button>
                {hasNext && (
                  <Btn label="Следующая серия (N)" onClick={onNext}>
                    <SkipForward size={19} fill="currentColor" />
                  </Btn>
                )}
                <Btn label="−10 сек (J)" onClick={() => seekBy(-10)} className="hidden md:flex">
                  <RotateCcw size={18} />
                </Btn>
                <Btn label="+10 сек (L)" onClick={() => seekBy(10)} className="hidden md:flex">
                  <RotateCw size={18} />
                </Btn>
                <div className="group/vol flex items-center">
                  <Btn label="Звук (M)" onClick={toggleMute}>
                    <VolumeIcon size={20} />
                  </Btn>
                  {!isIOS && (
                    <div className="w-0 overflow-hidden transition-all duration-300 group-hover/vol:w-24">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={volume.muted ? 0 : volume.volume}
                        onChange={(e) => setVolume(Number(e.target.value))}
                        className="slider mx-2 w-20"
                        style={{ ['--val' as string]: `${(volume.muted ? 0 : volume.volume) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="glass flex items-center gap-0.5 rounded-2xl p-1.5 ring-1 ring-white/10">
                <Btn label="Управление плеером Kodik (качество, субтитры)" onClick={() => setNative('manual')}>
                  <MousePointerClick size={19} />
                </Btn>
                <Btn label="Полный экран (F)" onClick={toggleFullscreen}>
                  {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
                </Btn>
              </div>
            </div>

            <div className="glass flex items-center gap-4 rounded-2xl px-4 py-3 ring-1 ring-white/10">
              <span className="w-14 text-sm font-bold tabular-nums">{fmtTime(shownTime)}</span>
              <div
                ref={barRef}
                className="group/bar relative flex h-5 flex-1 cursor-pointer touch-none items-center"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setScrub(posFromEvent(e.clientX).t)
                }}
                onPointerMove={(e) => {
                  const p = posFromEvent(e.clientX)
                  setHover(p)
                  if (scrub != null) setScrub(p.t)
                  poke()
                }}
                onPointerUp={() => {
                  if (scrub != null) seek(scrub)
                  setScrub(null)
                }}
                onPointerLeave={() => scrub == null && setHover(null)}
              >
                <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/15 transition-all group-hover/bar:h-1.5">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${pct(shownTime)}%` }} />
                  {skip.op && (
                    <div className="absolute inset-y-0 bg-emerald-400/85" style={{ left: `${pct(skip.op.start)}%`, width: `${pct(skip.op.stop - skip.op.start)}%` }} />
                  )}
                  {skip.ed && (
                    <div className="absolute inset-y-0 bg-orange-500/85" style={{ left: `${pct(skip.ed.start)}%`, width: `${pct(skip.ed.stop - skip.ed.start)}%` }} />
                  )}
                </div>
                <div
                  className={cn('absolute h-4 w-4 -translate-x-1/2 rounded-full bg-white shadow-lg shadow-black/50 transition-transform', scrub != null ? 'scale-125' : 'scale-100')}
                  style={{ left: `${pct(shownTime)}%` }}
                />
                {hover && duration > 0 && (
                  <div className="pointer-events-none absolute bottom-7 -translate-x-1/2 rounded-lg bg-black/85 px-2 py-1 text-xs font-bold tabular-nums" style={{ left: hover.x }}>
                    {fmtTime(hover.t)}
                    {skip.op && hover.t >= skip.op.start && hover.t < skip.op.stop && <span className="ml-1 text-emerald-400">опенинг</span>}
                    {skip.ed && hover.t >= skip.ed.start && hover.t < skip.ed.stop && <span className="ml-1 text-orange-400">эндинг</span>}
                  </div>
                )}
              </div>
              <span className="w-16 text-right text-sm font-bold text-white/80 tabular-nums">-{fmtTime(Math.max(0, duration - shownTime))}</span>
            </div>
          </div>
        </>
      )}

      {native && isKodik && (
        <button
          className="animate-pop glass absolute top-4 right-4 flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-bold ring-1 ring-white/15 hover:bg-white/15"
          onClick={() => setNative(false)}
        >
          Наше управление
        </button>
      )}

      {toast && (
        <div className="animate-pop glass pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-2xl px-4 py-2.5 text-sm font-semibold ring-1 ring-white/10">
          {toast}
        </div>
      )}
      {autoSkip && (
        <div className={cn('animate-pop absolute right-5 flex items-center gap-2', ours ? 'bottom-36' : 'bottom-20')}>
          <button
            className="relative overflow-hidden rounded-2xl bg-black/55 px-5 py-3 text-sm font-bold text-white shadow-xl ring-1 ring-white/20 backdrop-blur-xl hover:bg-black/70"
            onClick={() => setAutoSkip(null)}
          >
            <span className="absolute inset-y-0 left-0 bg-white/20" style={{ width: `${(1 - autoSkip.left / AUTO_SKIP_MS) * 100}%` }} />
            <span className="relative flex items-center gap-2">
              <Play size={16} fill="currentColor" />
              {autoSkip.kind === 'op' ? 'Смотреть опенинг' : 'Смотреть эндинг'}
              <span className="text-white/60 tabular-nums">{Math.ceil(autoSkip.left / 1000)}</span>
            </span>
          </button>
          <button className="rounded-2xl bg-white px-4 py-3 text-black shadow-xl" title="Пропустить сейчас" onClick={() => setAutoSkip((a) => (a ? { ...a, left: 0 } : a))}>
            <FastForward size={18} fill="currentColor" />
          </button>
        </div>
      )}
      {!autoSkip && (inOp || (inEd && !hasNext)) && (
        <button
          className={cn('animate-pop absolute right-5 flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-black shadow-xl', ours ? 'bottom-36' : 'bottom-20')}
          onClick={() => (inOp ? seek(skip.op!.stop) : seek(skip.ed!.stop))}
        >
          <FastForward size={18} fill="currentColor" /> {inOp ? 'Пропустить опенинг' : 'Пропустить эндинг'}
        </button>
      )}
      {!autoSkip && inEd && hasNext && (
        <button
          className={cn('animate-pop absolute right-5 flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-black shadow-xl', ours ? 'bottom-36' : 'bottom-20')}
          onClick={onNext}
        >
          <SkipForward size={18} fill="currentColor" /> Следующая серия
        </button>
      )}
      {nextIn != null && (
        <div className="animate-fade-in absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75 backdrop-blur-sm">
          <div className="text-lg font-bold">Следующая серия через {nextIn}</div>
          <div className="flex gap-3">
            <button className="rounded-full bg-white/10 px-5 py-2.5 font-semibold" onClick={() => setNextIn(null)}>
              Отмена
            </button>
            <button className="rounded-full bg-white px-5 py-2.5 font-bold text-black" onClick={onNext}>
              Смотреть сейчас
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Btn({ children, label, onClick, className }: { children: React.ReactNode; label: string; onClick: () => void; className?: string }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn('flex h-11 w-11 items-center justify-center rounded-xl text-white/90 transition hover:bg-white/12 hover:text-white active:scale-95', className)}
    >
      {children}
    </button>
  )
}
