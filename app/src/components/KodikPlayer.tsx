import { useCallback, useEffect, useRef, useState } from 'react'
import { FastForward, Play, SkipForward } from 'lucide-react'
import { aniskip, type Release } from '../lib/api'
import { kodikCommand, kodikEpisodeUrl, type Dub } from '../lib/kodik'
import { useStore, getProgress, WATCHED_RATIO } from '../lib/store'
import { waitForFirstSync } from '../lib/sync'
import { anilistReportEpisode } from '../lib/anilist'
import { onAppHide } from '../lib/platform'
import { fmtTime, cn } from '../lib/format'

const AUTO_SKIP_MS = 5000
type Seg = { start: number; stop: number }

/** Kodik's iframe player wired into our progress, history, stats and auto-skip */
export default function KodikPlayer({
  release,
  dub,
  episode,
  hasNext,
  onNext,
}: {
  release: Release
  dub: Dub
  episode: number
  hasNext: boolean
  onNext: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const st = useRef({ time: 0, duration: 0, playing: false, played: 0, pendingWatch: 0, lastSave: 0, resumed: false, reported: false, skippedOp: false, skippedEd: false })
  const [skip, setSkip] = useState<{ op?: Seg; ed?: Seg }>({})
  const [autoSkip, setAutoSkip] = useState<{ kind: 'op' | 'ed'; left: number } | null>(null)
  const [time, setTime] = useState(0)
  const [toast, setToast] = useState('')
  const [playing, setPlaying] = useState(false)
  const [nextIn, setNextIn] = useState<number | null>(null)
  const src = kodikEpisodeUrl(dub, episode)
  const malId = release.mal?.id

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
    st.current = { time: 0, duration: 0, playing: false, played: 0, pendingWatch: 0, lastSave: 0, resumed: false, reported: false, skippedOp: false, skippedEd: false }
    setAutoSkip(null)
    setNextIn(null)
    setSkip({})
    if (malId) aniskip(malId, episode).then(setSkip)
    return () => save(true)
  }, [episode, dub.id, malId, save])

  const seek = (t: number) => kodikCommand(frameRef.current, 'seek', { seconds: Math.max(0, t) })

  const markWatched = useCallback(() => {
    const s = st.current
    if (s.reported) return
    s.reported = true
    useStore.getState().setWatched(release.id, episode, true, s.duration)
    void anilistReportEpisode(malId, episode)
  }, [release.id, episode, malId])

  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return
      const { key, value } = (e.data ?? {}) as { key?: string; value?: unknown }
      const s = st.current
      if (key === 'kodik_player_duration_update' && typeof value === 'number') s.duration = value
      else if (key === 'kodik_player_play' || key === 'kodik_player_video_started') {
        s.playing = true
        setPlaying(true)
        if (!s.resumed) {
          s.resumed = true
          await waitForFirstSync()
          const p = getProgress(release.id, episode)
          if (p && !p.watched && p.time > 5 && (!p.duration || p.time < p.duration - 15)) {
            seek(p.time)
            setToast(`Продолжаем с ${fmtTime(p.time)}`)
          }
        }
      } else if (key === 'kodik_player_pause') {
        s.playing = false
        setPlaying(false)
        save(true)
      } else if ((key === 'kodik_player_time_update' || key === 'kodik_player_time') && typeof value === 'number') {
        const d = value - s.time
        if (s.playing && d > 0 && d < 3) {
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
        if (hasNext && useStore.getState().prefs.autoNext) setNextIn(5)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [release.id, episode, save, markWatched, hasNext, skip.ed])

  // Kodik pushes time updates only on some builds: ask for it every second as well
  useEffect(() => {
    const t = setInterval(() => kodikCommand(frameRef.current, 'get_time'), 1000)
    return () => clearInterval(t)
  }, [src])

  // offer "watch opening" for 5 seconds, then skip
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

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-3xl bg-black shadow-2xl shadow-black/60 ring-1 ring-white/5">
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
      {toast && (
        <div className="animate-pop glass pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-2xl px-4 py-2.5 text-sm font-semibold ring-1 ring-white/10">
          {toast}
        </div>
      )}
      {autoSkip && (
        <div className="animate-pop absolute right-5 bottom-20 flex items-center gap-2">
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
          <button
            className="rounded-2xl bg-white px-4 py-3 text-black shadow-xl"
            title="Пропустить сейчас"
            onClick={() => setAutoSkip((a) => (a ? { ...a, left: 0 } : a))}
          >
            <FastForward size={18} fill="currentColor" />
          </button>
        </div>
      )}
      {!autoSkip && (inOp || (inEd && !hasNext)) && (
        <button
          className="animate-pop absolute right-5 bottom-20 flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-black shadow-xl"
          onClick={() => (inOp ? seek(skip.op!.stop) : seek(skip.ed!.stop))}
        >
          <FastForward size={18} fill="currentColor" /> {inOp ? 'Пропустить опенинг' : 'Пропустить эндинг'}
        </button>
      )}
      {!autoSkip && inEd && hasNext && (
        <button className="animate-pop absolute right-5 bottom-20 flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-black shadow-xl" onClick={onNext}>
          <SkipForward size={18} fill="currentColor" /> Следующая серия
        </button>
      )}
      {nextIn != null && (
        <div className={cn('animate-fade-in absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75 backdrop-blur-sm')}>
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
