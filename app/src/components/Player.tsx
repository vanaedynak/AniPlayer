import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import Hls from 'hls.js'
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  PictureInPicture2,
  RotateCcw,
  RotateCw,
  Check,
  ChevronRight,
  ChevronLeft,
  FastForward,
  Loader2,
} from 'lucide-react'
import { episodePreview, aniskip, type Episode, type Release } from '../lib/api'
import { useStore, getProgress, progressKey, WATCHED_RATIO } from '../lib/store'
import { waitForFirstSync } from '../lib/sync'
import { anilistReportEpisode } from '../lib/anilist'
import { onAppHide, isIOS, isElectron } from '../lib/platform'
import { fmtTime, fmtOrdinal, cn } from '../lib/format'

type Quality = '480' | '720' | '1080'
const QUALITIES: Quality[] = ['1080', '720', '480']
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const AUTO_SKIP_MS = 5000

interface Props {
  release: Release
  episode: Episode
  next?: Episode
  prev?: Episode
  onSelect: (e: Episode) => void
}

function sourceFor(ep: Episode, q: Quality): { url: string; q: Quality } | null {
  const order = [q, ...QUALITIES.filter((x) => x !== q)]
  for (const x of order) {
    const url = ep[`hls_${x}` as const]
    if (url) return { url, q: x }
  }
  return null
}

const useNativeHls = () => isIOS && !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl')

export default function Player({ release, episode, next, prev, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const prefs = useStore((s) => s.prefs)
  const local = useStore((s) => s.local)
  const setPrefs = useStore((s) => s.setPrefs)
  const setLocal = useStore((s) => s.setLocal)

  const [quality, setQuality] = useState<Quality>(prefs.quality)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(episode.duration ?? 0)
  const [buffered, setBuffered] = useState(0)
  const [controls, setControls] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [menu, setMenu] = useState<null | 'main' | 'quality' | 'speed'>(null)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [toast, setToast] = useState<{ text: string; action?: { label: string; fn: () => void } } | null>(null)
  const [ripple, setRipple] = useState<{ side: 'l' | 'r'; id: number; secs: number } | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [autoSkip, setAutoSkip] = useState<{ kind: 'op' | 'ed'; left: number } | null>(null)
  const [error, setError] = useState('')

  // per-episode session bookkeeping (refs: no re-render needed)
  const session = useRef({ played: 0, lastMedia: -1, pendingWatch: 0, reported: false, skippedOp: false, skippedEd: false, lastSave: 0 })
  const resumeAt = useRef<number | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // AniLibria's own markup first, AniSkip (crowd-sourced, by MAL id) when it's missing
  const ownOp = episode.opening?.start != null && episode.opening?.stop ? episode.opening : null
  const ownEd = episode.ending?.start != null && episode.ending?.stop ? episode.ending : null
  const [extSkip, setExtSkip] = useState<{ op?: { start: number; stop: number }; ed?: { start: number; stop: number } }>({})
  useEffect(() => {
    setExtSkip({})
    const mal = release.mal?.id
    if (!mal || (ownOp && ownEd)) return
    let alive = true
    aniskip(mal, Math.floor(episode.ordinal), episode.duration ?? 0).then((r) => alive && setExtSkip(r))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.id])
  const op = useMemo(() => ownOp ?? extSkip.op ?? null, [ownOp, extSkip.op])
  const ed = useMemo(() => ownEd ?? extSkip.ed ?? null, [ownEd, extSkip.ed])

  // ---------- saving ----------
  const save = useCallback(
    (force = false) => {
      const v = videoRef.current
      if (!v || session.current.played < 3 || !v.duration) return
      useStore.getState().saveProgress(
        {
          releaseId: release.id,
          ordinal: episode.ordinal,
          time: v.currentTime,
          duration: v.duration,
          watched: false,
          preview: episodePreview(episode),
        },
        force,
      )
      const s = session.current
      if (s.pendingWatch > 0) {
        useStore.getState().addWatchTime(s.pendingWatch)
        s.pendingWatch = 0
      }
    },
    [release.id, episode],
  )

  useEffect(() => onAppHide(() => save(true)), [save])

  // ---------- source loading ----------
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let cancelled = false
    const src = sourceFor(episode, quality)
    setError('')
    if (!src) {
      setError('У этой серии нет видео')
      return
    }
    const keepTime = resumeAt.current // set when switching quality
    const wasPlaying = !v.paused || keepTime == null

    const start = async () => {
      let startAt = keepTime ?? 0
      if (keepTime == null) {
        await waitForFirstSync()
        if (cancelled) return
        const p = getProgress(release.id, episode.ordinal)
        const dur = p?.duration || episode.duration || 0
        if (p && !p.watched && p.time > 5 && (!dur || p.time < dur - 15)) {
          startAt = p.time
          setToast({
            text: `Продолжаем с ${fmtTime(p.time)}`,
            action: { label: 'С начала', fn: () => seek(0) },
          })
        }
      }
      resumeAt.current = null

      hlsRef.current?.destroy()
      hlsRef.current = null
      if (useNativeHls() || !Hls.isSupported()) {
        v.src = src.url
        const onMeta = () => {
          if (startAt) v.currentTime = startAt
          v.removeEventListener('loadedmetadata', onMeta)
        }
        v.addEventListener('loadedmetadata', onMeta)
      } else {
        const hls = new Hls({ startPosition: startAt || -1, maxBufferLength: 45, maxMaxBufferLength: 120, enableWorker: true })
        hlsRef.current = hls
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
          else setError('Не удалось загрузить видео')
        })
        hls.loadSource(src.url)
        hls.attachMedia(v)
      }
      v.playbackRate = useStore.getState().local.rate
      if (wasPlaying) v.play().catch(() => setPlaying(false))
    }
    void start()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.id, quality])

  // new episode → reset session, save the old one on the way out
  useEffect(() => {
    session.current = { played: 0, lastMedia: -1, pendingWatch: 0, reported: false, skippedOp: false, skippedEd: false, lastSave: 0 }
    setCountdown(null)
    setAutoSkip(null)
    setTime(0)
    setDuration(episode.duration ?? 0)
    setWaiting(true)
    return () => save(true)
  }, [episode.id, episode.duration, save])

  useEffect(
    () => () => {
      hlsRef.current?.destroy()
    },
    [],
  )

  // a newer position arrived from another device before we started watching
  useEffect(() => {
    const key = progressKey(release.id, episode.ordinal)
    return useStore.subscribe((s, prevS) => {
      const p = s.progress[key]
      const v = videoRef.current
      if (!p || p === prevS.progress[key] || !v) return
      if (session.current.played < 3 && v.paused && !p.watched && Math.abs(p.time - v.currentTime) > 5) {
        v.currentTime = p.time
        setToast({ text: `Синхронизировано: ${fmtTime(p.time)}` })
      }
    })
  }, [release.id, episode.ordinal])

  // volume / rate from prefs
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = local.volume
    v.muted = local.muted
  }, [local.volume, local.muted])

  // ---------- controls visibility ----------
  const poke = useCallback(() => {
    setControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused) {
        setControls(false)
        setMenu(null)
      }
    }, 2800)
  }, [])

  useEffect(() => {
    if (!playing) setControls(true)
    else poke()
  }, [playing, poke])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  // ---------- actions ----------
  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [])

  const seek = useCallback((t: number) => {
    const v = videoRef.current
    if (!v) return
    const d = v.duration || duration
    v.currentTime = Math.max(0, Math.min(d ? d - 0.5 : t, t))
    setTime(v.currentTime)
  }, [duration])

  const seekBy = useCallback(
    (d: number) => {
      const v = videoRef.current
      if (v) seek(v.currentTime + d)
    },
    [seek],
  )

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (doc.exitFullscreen) doc.exitFullscreen()
      else doc.webkitExitFullscreen?.()
      return
    }
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.())
    else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen()
    else v?.webkitEnterFullscreen?.()
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

  const togglePip = useCallback(async () => {
    const v = videoRef.current as (HTMLVideoElement & { webkitSetPresentationMode?: (m: string) => void }) | null
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else if (v.requestPictureInPicture) await v.requestPictureInPicture()
      else v.webkitSetPresentationMode?.('picture-in-picture')
    } catch {
      /* not supported */
    }
  }, [])

  const setVolume = (vol: number) => setLocal({ volume: Math.max(0, Math.min(1, vol)), muted: vol <= 0 })
  const toggleMute = () => setLocal({ muted: !local.muted, volume: local.muted && local.volume === 0 ? 0.6 : local.volume })

  const setRate = (r: number) => {
    if (videoRef.current) videoRef.current.playbackRate = r
    setLocal({ rate: r })
  }

  const changeQuality = (q: Quality) => {
    const v = videoRef.current
    resumeAt.current = v?.currentTime ?? 0
    setQuality(q)
    setPrefs({ quality: q })
    setMenu(null)
  }

  const goNext = useCallback(() => {
    if (next) {
      save(true)
      onSelect(next)
    }
  }, [next, onSelect, save])

  // ---------- media events ----------
  const markWatched = useCallback(() => {
    const s = session.current
    if (s.reported) return
    s.reported = true
    const v = videoRef.current
    useStore.getState().setWatched(release.id, episode.ordinal, true, v?.duration)
    void anilistReportEpisode(release.mal?.id, episode.ordinal)
  }, [release.id, release.mal?.id, episode.ordinal])

  const onTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    const t = v.currentTime
    setTime(t)
    const s = session.current
    if (!v.paused && s.lastMedia >= 0) {
      const d = t - s.lastMedia
      if (d > 0 && d < 3) {
        s.played += d
        s.pendingWatch += d
      }
    }
    s.lastMedia = t
    if (v.buffered.length) {
      for (let i = 0; i < v.buffered.length; i++)
        if (v.buffered.start(i) <= t + 0.5 && v.buffered.end(i) >= t) setBuffered(v.buffered.end(i))
    }
    const now = Date.now()
    if (now - s.lastSave > 2000) {
      s.lastSave = now
      save()
    }

    // auto-skip: offer "watch it" for 5 seconds, then skip on our own
    const prefsNow = useStore.getState().prefs
    const inOpNow = !!op && t >= op.start! && t < op.stop! - 1
    const inEdNow = !!ed && t >= ed.start! && t < ed.stop! - 1
    if (inOpNow && prefsNow.autoSkipOpening && !s.skippedOp) {
      s.skippedOp = true
      setAutoSkip({ kind: 'op', left: AUTO_SKIP_MS })
    }
    if (inEdNow && prefsNow.autoSkipEnding && !s.skippedEd) {
      s.skippedEd = true
      setAutoSkip({ kind: 'ed', left: AUTO_SKIP_MS })
    }
    // seeking back before a segment re-arms its auto-skip; leaving it drops a pending one
    if (op && t < op.start! - 1) s.skippedOp = false
    if (ed && t < ed.start! - 1) s.skippedEd = false
    setAutoSkip((a) => (a && ((a.kind === 'op' && !inOpNow) || (a.kind === 'ed' && !inEdNow)) ? null : a))
    const d = v.duration
    if (d && (t / d >= WATCHED_RATIO || (ed && t >= ed.start!))) markWatched()
  }

  const onEnded = () => {
    save(true)
    markWatched()
    if (next && useStore.getState().prefs.autoNext) setCountdown(5)
  }

  useEffect(() => {
    if (countdown == null) return
    if (countdown <= 0) {
      setCountdown(null)
      goNext()
      return
    }
    const t = setTimeout(() => setCountdown((c) => (c == null ? null : c - 1)), 1000)
    return () => clearTimeout(t)
  }, [countdown, goNext])

  // auto-skip timer only runs while the video is playing
  useEffect(() => {
    if (!autoSkip || !playing) return
    if (autoSkip.left <= 0) {
      setAutoSkip(null)
      if (autoSkip.kind === 'op' && op) {
        seek(op.stop!)
        setToast({ text: 'Опенинг пропущен' })
      } else if (autoSkip.kind === 'ed' && ed) {
        if (next && useStore.getState().prefs.autoNext) goNext()
        else seek(ed.stop!)
      }
      return
    }
    // measure real elapsed time so a throttled timer can't stretch the 5 seconds
    let last = performance.now()
    const t = setInterval(() => {
      const now = performance.now()
      const dt = now - last
      last = now
      setAutoSkip((a) => (a ? { ...a, left: a.left - dt } : a))
    }, 100)
    return () => clearInterval(t)
  }, [autoSkip, playing, op, ed, next, seek, goNext])

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return
      const v = videoRef.current
      if (!v) return
      const k = e.key.toLowerCase()
      const handled = true
      if (k === ' ' || k === 'k' || k === 'л') togglePlay()
      else if (k === 'arrowleft') seekBy(-5)
      else if (k === 'arrowright') seekBy(5)
      else if (k === 'j' || k === 'о') seekBy(-10)
      else if (k === 'l' || k === 'д') seekBy(10)
      else if (k === 'arrowup') setVolume(local.volume + 0.05)
      else if (k === 'arrowdown') setVolume(local.volume - 0.05)
      else if (k === 'f' || k === 'а') toggleFullscreen()
      else if (k === 'm' || k === 'ь') toggleMute()
      else if (k === 'n' || k === 'т') goNext()
      else if (k === 's' || k === 'ы') skipSegment()
      else if (/^[0-9]$/.test(k) && v.duration) seek((v.duration * Number(k)) / 10)
      else return
      if (handled) {
        e.preventDefault()
        poke()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---------- gestures ----------
  const lastTap = useRef<{ t: number; x: number }>({ t: 0, x: 0 })
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onSurfacePointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (menu) {
      setMenu(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const now = Date.now()
    const isDouble = now - lastTap.current.t < 300 && Math.abs(x - lastTap.current.x) < 80
    lastTap.current = { t: now, x }
    if (e.pointerType === 'mouse') {
      clearTimeout(tapTimer.current)
      if (isDouble) toggleFullscreen()
      else tapTimer.current = setTimeout(togglePlay, 220)
      // undo the single-click toggle if it turns out to be a double click
      return
    }
    // touch: tap shows/hides controls, double tap on sides seeks
    if (isDouble && x < rect.width * 0.38) {
      clearTimeout(tapTimer.current)
      seekBy(-10)
      setRipple((r) => ({ side: 'l', id: now, secs: r?.side === 'l' ? r.secs + 10 : 10 }))
    } else if (isDouble && x > rect.width * 0.62) {
      clearTimeout(tapTimer.current)
      seekBy(10)
      setRipple((r) => ({ side: 'r', id: now, secs: r?.side === 'r' ? r.secs + 10 : 10 }))
    } else {
      clearTimeout(tapTimer.current)
      tapTimer.current = setTimeout(() => {
        if (controls && playing) setControls(false)
        else poke()
      }, 250)
    }
  }

  // the seek hint fades out shortly after the last double tap; repeated taps add up like on YouTube
  useEffect(() => {
    if (!ripple) return
    const t = setTimeout(() => setRipple(null), 700)
    return () => clearTimeout(t)
  }, [ripple])

  // ---------- seek bar ----------
  const posFromEvent = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    return { x: ratio * r.width, t: ratio * (duration || 0) }
  }
  const onBarDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setScrub(posFromEvent(e.clientX).t)
  }
  const onBarMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = posFromEvent(e.clientX)
    setHover(p)
    if (scrub != null) setScrub(p.t)
    poke()
  }
  const onBarUp = () => {
    if (scrub != null) seek(scrub)
    setScrub(null)
  }

  // ---------- skip ----------
  const shownTime = scrub ?? time
  const inOp = !!op && time >= op.start! && time < op.stop! - 1
  const inEd = !!ed && time >= ed.start! && time < ed.stop! - 1
  function skipSegment() {
    if (inOp) seek(op!.stop!)
    else if (inEd) {
      if (next) goNext()
      else seek(ed!.stop!)
    }
  }

  const pct = (t: number) => (duration ? (t / duration) * 100 : 0)
  const VolumeIcon = local.muted || local.volume === 0 ? VolumeX : local.volume < 0.5 ? Volume1 : Volume2
  const poster = episodePreview(episode)

  return (
    <div
      ref={wrapRef}
      className={cn(
        'group/player relative w-full overflow-hidden bg-black select-none',
        fullscreen ? 'h-full' : 'aspect-video rounded-3xl shadow-2xl shadow-black/60 ring-1 ring-white/5',
        !controls && playing && 'cursor-none',
      )}
      onPointerMove={(e) => e.pointerType === 'mouse' && poke()}
      onMouseLeave={() => playing && setControls(false)}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full"
        poster={poster}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false)
          save(true)
        }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onPlaying={() => setWaiting(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={onTimeUpdate}
        onSeeked={() => save(true)}
        onEnded={onEnded}
        onError={() => !hlsRef.current && setError('Не удалось воспроизвести видео')}
      />

      {/* tap / click surface */}
      <div className="absolute inset-0" onPointerUp={onSurfacePointerUp} />

      {/* double-tap ripple */}
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

      {/* buffering */}
      {waiting && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="animate-spin text-white/90" size={54} strokeWidth={2.2} />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center">
          <p className="text-lg font-semibold">{error}</p>
          <button
            className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black"
            onClick={() => {
              resumeAt.current = videoRef.current?.currentTime ?? 0
              setQuality((q) => (q === '1080' ? '720' : q === '720' ? '480' : '1080'))
            }}
          >
            Попробовать другое качество
          </button>
        </div>
      )}

      {/* big center play */}
      {!playing && !waiting && !error && countdown == null && (
        <button
          className="animate-pop absolute top-1/2 left-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-black shadow-2xl transition hover:scale-105"
          onClick={togglePlay}
          aria-label="Смотреть"
        >
          <Play size={34} fill="currentColor" className="ml-1" />
        </button>
      )}

      {/* top bar */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 to-transparent px-6 pt-5 pb-14 transition-opacity duration-300',
          controls ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="text-xs font-semibold tracking-wide text-white/60 uppercase">{release.name.main}</div>
        <div className="text-lg font-bold">
          {fmtOrdinal(episode.ordinal)} серия{episode.name ? <span className="font-medium text-white/70"> · {episode.name}</span> : null}
        </div>
      </div>

      {/* toast */}
      {toast && (
        <div className="animate-pop glass absolute top-5 right-5 flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-semibold ring-1 ring-white/10">
          {toast.text}
          {toast.action && (
            <button
              className="rounded-full bg-white/15 px-3 py-1 text-xs hover:bg-white/25"
              onClick={() => {
                toast.action!.fn()
                setToast(null)
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      {/* skip opening / ending */}
      {autoSkip && countdown == null ? (
        <div className="animate-pop absolute right-6 bottom-32 flex items-center gap-2" onPointerUp={(e) => e.stopPropagation()}>
          <button
            className="relative overflow-hidden rounded-2xl bg-white/15 px-5 py-3 text-sm font-bold text-white shadow-xl ring-1 ring-white/20 backdrop-blur-xl transition hover:bg-white/25"
            onClick={() => setAutoSkip(null)}
          >
            <span
              className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-100 ease-linear"
              style={{ width: `${(1 - autoSkip.left / AUTO_SKIP_MS) * 100}%` }}
            />
            <span className="relative flex items-center gap-2">
              <Play size={16} fill="currentColor" />
              {autoSkip.kind === 'op' ? 'Смотреть опенинг' : 'Смотреть эндинг'}
              <span className="text-white/60 tabular-nums">{Math.ceil(autoSkip.left / 1000)}</span>
            </span>
          </button>
          <button
            className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-black shadow-xl transition hover:scale-[1.03]"
            onClick={() => setAutoSkip((a) => (a ? { ...a, left: 0 } : a))}
            title="Пропустить сейчас"
          >
            <FastForward size={18} fill="currentColor" />
          </button>
        </div>
      ) : (
        (inOp || inEd) &&
        countdown == null && (
          <button
            className="animate-pop absolute right-6 bottom-32 flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-black shadow-xl transition hover:scale-[1.03]"
            onPointerUp={(e) => e.stopPropagation()}
            onClick={skipSegment}
          >
            <FastForward size={18} fill="currentColor" />
            {inOp ? 'Пропустить опенинг' : next ? 'Следующая серия' : 'Пропустить эндинг'}
          </button>
        )
      )}

      {/* autoplay countdown */}
      {countdown != null && next && (
        <div className="animate-fade-in absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex w-[min(420px,90%)] flex-col items-center gap-4 text-center">
            <div className="text-sm font-semibold text-white/60">Следующая серия через {countdown}</div>
            <div className="relative w-full overflow-hidden rounded-2xl ring-1 ring-white/10">
              <img src={episodePreview(next)} className="aspect-video w-full object-cover" alt="" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 text-left">
                <div className="text-lg font-bold">{fmtOrdinal(next.ordinal)} серия</div>
                {next.name && <div className="text-sm text-white/70">{next.name}</div>}
              </div>
              <div
                className="absolute bottom-0 left-0 h-1 bg-accent transition-[width] duration-1000 ease-linear"
                style={{ width: `${((5 - countdown) / 5) * 100}%` }}
              />
            </div>
            <div className="flex gap-3">
              <button className="rounded-full bg-white/10 px-5 py-2.5 font-semibold hover:bg-white/20" onClick={() => setCountdown(null)}>
                Отмена
              </button>
              <button className="rounded-full bg-white px-5 py-2.5 font-bold text-black" onClick={goNext}>
                Смотреть сейчас
              </button>
            </div>
          </div>
        </div>
      )}

      {/* bottom controls */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pt-16 pb-3 transition-all duration-300 sm:px-5 sm:pb-5',
          controls || menu ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        )}
      >
        <div className="mb-3 flex items-end justify-between gap-2">
          <div className="glass flex items-center gap-0.5 rounded-2xl p-1.5 ring-1 ring-white/10">
            {prev && (
              <CtrlBtn label="Предыдущая серия" onClick={() => onSelect(prev)} className="hidden sm:flex">
                <SkipBack size={19} fill="currentColor" />
              </CtrlBtn>
            )}
            <button
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-black transition hover:scale-105"
              onClick={togglePlay}
              aria-label={playing ? 'Пауза' : 'Смотреть'}
            >
              {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
            </button>
            {next && (
              <CtrlBtn label="Следующая серия (N)" onClick={goNext}>
                <SkipForward size={19} fill="currentColor" />
              </CtrlBtn>
            )}
            <CtrlBtn label="−10 сек (J)" onClick={() => seekBy(-10)} className="hidden md:flex">
              <RotateCcw size={18} />
            </CtrlBtn>
            <CtrlBtn label="+10 сек (L)" onClick={() => seekBy(10)} className="hidden md:flex">
              <RotateCw size={18} />
            </CtrlBtn>
            <div className="group/vol flex items-center">
              <CtrlBtn label="Звук (M)" onClick={toggleMute}>
                <VolumeIcon size={20} />
              </CtrlBtn>
              {!isIOS && (
                <div className="w-0 overflow-hidden transition-all duration-300 group-hover/vol:w-24">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={local.muted ? 0 : local.volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="slider mx-2 w-20"
                    style={{ ['--val' as string]: `${(local.muted ? 0 : local.volume) * 100}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="relative">
            {menu && (
              <SettingsMenu
                menu={menu}
                setMenu={setMenu}
                episode={episode}
                quality={quality}
                changeQuality={changeQuality}
                rate={local.rate}
                setRate={setRate}
              />
            )}
            <div className="glass flex items-center gap-0.5 rounded-2xl p-1.5 ring-1 ring-white/10">
              <CtrlBtn label="Настройки" onClick={() => setMenu(menu ? null : 'main')} active={!!menu}>
                <Settings size={19} className={cn('transition-transform duration-300', menu && 'rotate-45')} />
              </CtrlBtn>
              <span className="hidden px-1.5 text-xs font-bold text-white/70 sm:block">{quality}p</span>
              <CtrlBtn label="Картинка в картинке" onClick={togglePip}>
                <PictureInPicture2 size={19} />
              </CtrlBtn>
              <CtrlBtn label="Полный экран (F)" onClick={toggleFullscreen}>
                {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
              </CtrlBtn>
            </div>
          </div>
        </div>

        <div className="glass flex items-center gap-4 rounded-2xl px-4 py-3 ring-1 ring-white/10">
          <span className="w-14 text-sm font-bold tabular-nums">{fmtTime(shownTime)}</span>
          <div
            ref={barRef}
            className="group/bar relative flex h-5 flex-1 cursor-pointer touch-none items-center"
            onPointerDown={onBarDown}
            onPointerMove={onBarMove}
            onPointerUp={onBarUp}
            onPointerLeave={() => scrub == null && setHover(null)}
          >
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/15 transition-all group-hover/bar:h-1.5">
              <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${pct(buffered)}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${pct(shownTime)}%` }} />
              {/* opening = green, ending = orange, drawn on top so they show on the watched part too */}
              {op && (
                <div className="absolute inset-y-0 bg-emerald-400/85" style={{ left: `${pct(op.start!)}%`, width: `${pct(op.stop! - op.start!)}%` }} />
              )}
              {ed && (
                <div className="absolute inset-y-0 bg-orange-500/85" style={{ left: `${pct(ed.start!)}%`, width: `${pct(ed.stop! - ed.start!)}%` }} />
              )}
            </div>
            <div
              className={cn(
                'absolute h-4 w-4 -translate-x-1/2 rounded-full bg-white shadow-lg shadow-black/50 transition-transform',
                scrub != null ? 'scale-125' : 'scale-100',
              )}
              style={{ left: `${pct(shownTime)}%` }}
            />
            {hover && duration > 0 && (
              <div
                className="pointer-events-none absolute bottom-7 -translate-x-1/2 rounded-lg bg-black/85 px-2 py-1 text-xs font-bold tabular-nums"
                style={{ left: hover.x }}
              >
                {fmtTime(hover.t)}
                {op && hover.t >= op.start! && hover.t < op.stop! && <span className="ml-1 text-emerald-400">опенинг</span>}
                {ed && hover.t >= ed.start! && hover.t < ed.stop! && <span className="ml-1 text-orange-400">эндинг</span>}
              </div>
            )}
          </div>
          <span className="w-16 text-right text-sm font-bold text-white/80 tabular-nums">-{fmtTime(Math.max(0, duration - shownTime))}</span>
        </div>
      </div>
      {isElectron && fullscreen && <div className="drag absolute inset-x-0 top-0 h-2" />}
    </div>
  )
}

function CtrlBtn({
  children,
  label,
  onClick,
  className,
  active,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  className?: string
  active?: boolean
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-xl text-white/90 transition hover:bg-white/12 hover:text-white active:scale-95',
        active && 'bg-white/15',
        className,
      )}
    >
      {children}
    </button>
  )
}

function SettingsMenu({
  menu,
  setMenu,
  episode,
  quality,
  changeQuality,
  rate,
  setRate,
}: {
  menu: 'main' | 'quality' | 'speed'
  setMenu: (m: null | 'main' | 'quality' | 'speed') => void
  episode: Episode
  quality: Quality
  changeQuality: (q: Quality) => void
  rate: number
  setRate: (r: number) => void
}) {
  const prefs = useStore((s) => s.prefs)
  const setPrefs = useStore((s) => s.setPrefs)
  const Row = ({ label, value, onClick }: { label: string; value: string; onClick: () => void }) => (
    <button className="flex w-full items-center justify-between gap-6 rounded-xl px-3 py-2.5 text-left hover:bg-white/10" onClick={onClick}>
      <span className="font-semibold">{label}</span>
      <span className="flex items-center gap-1 text-white/60">
        {value} <ChevronRight size={16} />
      </span>
    </button>
  )
  const Toggle = ({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) => (
    <button className="flex w-full items-center justify-between gap-6 rounded-xl px-3 py-2.5 text-left hover:bg-white/10" onClick={() => set(!on)}>
      <span className="font-semibold">{label}</span>
      <span className={cn('relative h-6 w-10 rounded-full transition-colors', on ? 'bg-accent' : 'bg-white/20')}>
        <span className={cn('absolute top-1 h-4 w-4 rounded-full bg-white transition-all', on ? 'left-5' : 'left-1')} />
      </span>
    </button>
  )
  const Back = ({ title }: { title: string }) => (
    <button className="mb-1 flex w-full items-center gap-1 rounded-xl px-2 py-2 font-bold hover:bg-white/10" onClick={() => setMenu('main')}>
      <ChevronLeft size={18} /> {title}
    </button>
  )
  return (
    <div
      className="animate-pop glass absolute right-0 bottom-full mb-2 w-72 rounded-2xl p-2 text-sm shadow-2xl ring-1 ring-white/10"
      onPointerUp={(e) => e.stopPropagation()}
    >
      {menu === 'main' && (
        <>
          <Row label="Качество" value={`${quality}p`} onClick={() => setMenu('quality')} />
          <Row label="Скорость" value={rate === 1 ? 'Обычная' : `${rate}×`} onClick={() => setMenu('speed')} />
          <div className="my-1 h-px bg-white/10" />
          <Toggle label="Пропускать опенинг" on={prefs.autoSkipOpening} set={(v) => setPrefs({ autoSkipOpening: v })} />
          <Toggle label="Пропускать эндинг" on={prefs.autoSkipEnding} set={(v) => setPrefs({ autoSkipEnding: v })} />
          <Toggle label="Автопереход" on={prefs.autoNext} set={(v) => setPrefs({ autoNext: v })} />
        </>
      )}
      {menu === 'quality' && (
        <>
          <Back title="Качество" />
          {QUALITIES.filter((q) => episode[`hls_${q}` as const]).map((q) => (
            <button key={q} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 hover:bg-white/10" onClick={() => changeQuality(q)}>
              <span className="font-semibold">
                {q}p {q === '1080' && <span className="ml-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold">FHD</span>}
              </span>
              {q === quality && <Check size={18} className="text-accent-2" />}
            </button>
          ))}
        </>
      )}
      {menu === 'speed' && (
        <>
          <Back title="Скорость" />
          {RATES.map((r) => (
            <button key={r} className="flex w-full items-center justify-between rounded-xl px-3 py-2 hover:bg-white/10" onClick={() => setRate(r)}>
              <span className="font-semibold">{r === 1 ? 'Обычная' : `${r}×`}</span>
              {r === rate && <Check size={18} className="text-accent-2" />}
            </button>
          ))}
        </>
      )}
    </div>
  )
}
