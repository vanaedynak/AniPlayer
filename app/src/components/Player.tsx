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
  Sparkles,
  Sun,
  Magnet,
  X,
} from 'lucide-react'
import { api, episodePreview, aniskip, sortedEpisodes, posterUrl, type Episode, type Release, type Torrent } from '../lib/api'
import { setNowPlaying } from '../lib/discord'
import {
  torrentSupported,
  torrentsFor,
  torrentTitle,
  torrentHint,
  episodeFile,
  episodeOf,
  anilibriaSource,
  userSource,
  subsFor,
  decodeText,
  parseSubs,
  embeddedCues,
  trackLabel,
  type TorSource,
  type TorrentInfo,
  type TorrentVideo,
  type EmbeddedSubs,
  type Cue,
} from '../lib/torrent'
import { TorrentOpenForm } from './TorrentOpen'
import { useStore, getProgress, progressKey, WATCHED_RATIO } from '../lib/store'
import { waitForFirstSync } from '../lib/sync'
import { anilistReportEpisode } from '../lib/anilist'
import { onAppHide, isIOS, isElectron, isTouch } from '../lib/platform'
import { fmtTime, fmtOrdinal, cn } from '../lib/format'
import { useRoomPlayback } from './Room'
import { downloaded, offlineUrl, OfflineLoader, useDownloads, dlKey } from '../lib/downloads'
import { useRoom } from '../lib/room'
import { startUpscale, upscaleSupported, UPSCALE_MODES, type UpscaleMode, type Upscaler } from '../lib/upscale'

type Quality = '480' | '720' | '1080'
type Menu = 'main' | 'quality' | 'speed' | 'upscale' | 'audio' | 'subs'
const QUALITIES: Quality[] = ['1080', '720', '480']
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const AUTO_SKIP_MS = 5000

interface Props {
  release: Release
  episode: Episode
  next?: Episode
  prev?: Episode
  onSelect: (e: Episode) => void
  /** a torrent to play instead of AniLibria's stream (the standalone torrent player) */
  source?: TorSource
  /** nothing is saved: no progress, history or watched marks (a torrent with no title behind it) */
  ephemeral?: boolean
}

/** the torrent file of an episode: the standalone player names it in the episode id, a title by its number */
function fileFor(info: TorrentInfo, ep: Episode): TorrentVideo | null {
  if (ep.id.startsWith('tf:')) return info.files.find((f) => `tf:${f.index}` === ep.id) ?? null
  return episodeFile(info.files, ep.ordinal)
}

type SubPick = { kind: 'emb'; track: number } | { kind: 'ext'; suffix: string } | null

function sourceFor(ep: Episode, q: Quality): { url: string; q: Quality } | null {
  const order = [q, ...QUALITIES.filter((x) => x !== q)]
  for (const x of order) {
    const url = ep[`hls_${x}` as const]
    if (url) return { url, q: x }
  }
  return null
}

const MB = 1024 * 1024
/** bytes to fetch before playing a torrent from second `t`: half a minute ahead, at least 24 MB (three 8 MB pieces) */
function torSpan(bps: number, t: number): [number, number] {
  const at = Math.max(0, t * bps - MB)
  return [at, at + Math.max(24 * MB, 30 * bps)]
}

const samePick = (a: SubPick, b: SubPick) =>
  a === b || (!!a && !!b && a.kind === b.kind && (a.kind === 'emb' ? a.track === (b as { track: number }).track : a.suffix === (b as { suffix: string }).suffix))

const nativeHls = () => isIOS && !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl')

export default function Player({ release, episode, next, prev, onSelect, source, ephemeral }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

  // what is playing, for the Discord status (a few times a minute is plenty)
  const tick = Math.floor(time / 15)
  useEffect(() => {
    const poster = posterUrl(release)
    setNowPlaying({
      title: release.name.main,
      episode: `Серия ${episode.ordinal}${release.episodes_total ? ` из ${release.episodes_total}` : ''}`,
      poster: poster.startsWith('http') ? poster : '',
      path: location.hash.replace(/^#/, '') || `/watch/${release.alias}/${episode.ordinal}`,
      time,
      duration,
      playing,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release.id, episode.ordinal, playing, tick, duration])
  useEffect(() => () => setNowPlaying(null), [])
  const [fullscreen, setFullscreen] = useState(false)
  const [menu, setMenu] = useState<null | Menu>(null)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [toast, setToast] = useState<{ text: string; action?: { label: string; fn: () => void } } | null>(null)
  const [ripple, setRipple] = useState<{ side: 'l' | 'r'; id: number; secs: number } | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [autoSkip, setAutoSkip] = useState<{ kind: 'op' | 'ed'; left: number } | null>(null)
  const [error, setError] = useState('')

  // per-episode session bookkeeping (refs: no re-render needed)
  const session = useRef({ played: 0, lastMedia: -1, pendingWatch: 0, reported: false, skippedOp: false, skippedEd: false, lastSave: 0, ended: false })
  const resumeAt = useRef<number | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // AniLibria's own markup first, AniSkip (crowd-sourced, by MAL id) when it's missing
  const ownOp = episode.opening?.start != null && episode.opening?.stop ? episode.opening : null
  const ownEd = episode.ending?.start != null && episode.ending?.stop ? episode.ending : null
  const [extSkip, setExtSkip] = useState<{ op?: { start: number; stop: number }; ed?: { start: number; stop: number } }>({})
  useEffect(() => {
    setExtSkip({})
    const mal = release.mal?.id
    if (ownOp && ownEd) return
    let alive = true
    const len = episode.duration ?? 0
    void (async () => {
      const r = mal ? await aniskip(mal, Math.floor(episode.ordinal), len) : {}
      if (!alive) return
      setExtSkip(r)
      if (ownEd || r.ed || !len) return
      // nobody marked this episode's ending: a neighbour of the same length has the same ending in the same place
      const eps = sortedEpisodes(release)
      const i = eps.findIndex((e) => e.id === episode.id)
      for (const j of [i - 1, i + 1, i - 2, i + 2]) {
        const n = eps[j]
        if (!n?.duration || Math.abs(n.duration - len) > 3) continue
        const own = n.ending?.start != null && n.ending?.stop ? { start: n.ending.start, stop: n.ending.stop } : null
        const ed = own ?? (mal ? (await aniskip(mal, Math.floor(n.ordinal), n.duration)).ed : undefined)
        if (!alive) return
        if (ed && ed.stop <= len) return setExtSkip((s) => ({ ...s, ed }))
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.id])
  const op = useMemo(() => ownOp ?? extSkip.op ?? null, [ownOp, extSkip.op])
  const ed = useMemo(() => ownEd ?? extSkip.ed ?? null, [ownEd, extSkip.ed])

  const offline = useDownloads((s) => s.items[dlKey(release.id, episode.ordinal)]?.status === 'done')

  // ---------- torrent (desktop): AniLibria's own release at full bitrate, downloaded in playback order ----------
  const [torrents, setTorrents] = useState<Torrent[]>([])
  const [tor, setTor] = useState<TorSource | null>(source ?? null)
  const [torStats, setTorStats] = useState<{ peers: number; down: number } | null>(null)
  // live: the picture comes from the torrent now; warm: share of the bytes around the playhead already there
  const [torLive, setTorLive] = useState(false)
  const [torWarm, setTorWarm] = useState<number | null>(null)
  const torFile = useRef<{ hash: string; index: number } | null>(null)
  const torInfo = useRef<{ key: string; info: Promise<TorrentInfo> } | null>(null)
  // the torrent file on screen (or about to be): its dubs and subtitles are offered in the menu
  const [torCur, setTorCur] = useState<{ info: TorrentInfo; file: TorrentVideo } | null>(null)
  const [ownOpen, setOwnOpen] = useState(false)
  // AniLibria's stream plays while the torrent fetches the bytes around the playhead; then the source swaps
  const pending = useRef<{ url: string; hash: string; index: number; bps: number; warmedTo: number } | null>(null)
  const nextWarm = useRef('')
  const nextRef = useRef(next)
  nextRef.current = next
  useEffect(() => {
    if (!torrentSupported() || source) return
    let alive = true
    api
      .torrents(release.id)
      .then((l) => alive && setTorrents(l))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [release.id])
  const episodeTorrents = useMemo(() => torrentsFor(torrents, episode.ordinal), [torrents, episode.ordinal])
  useEffect(() => {
    if (!tor) {
      setTorStats(null)
      // back on AniLibria's stream: the torrent and its pieces go
      const f = torFile.current
      torFile.current = null
      torInfo.current = null
      pending.current = null
      setTorCur(null)
      if (f) void window.aniplayer?.torrent?.drop(f.hash)
      return
    }
    const bridge = window.aniplayer!.torrent!
    const id = setInterval(async () => {
      const f = torFile.current
      const v = videoRef.current
      const st = f ? await bridge.stats(f.hash, f.index).catch(() => null) : null
      setTorStats(st ? { peers: st.peers, down: st.down } : null)
      if (!v) return
      const p = pending.current
      if (p) {
        const at = v.currentTime * p.bps
        const need: [number, number] = [at - MB, at + Math.max(10 * MB, 12 * p.bps)]
        // playback outran the warm-up (or jumped): fetch from where it is now
        if (need[1] > p.warmedTo || need[0] < p.warmedTo - 200 * MB) {
          const [a, b] = torSpan(p.bps, v.currentTime)
          p.warmedTo = b
          void bridge.warm(p.hash, p.index, a, b)
        }
        const have = await bridge.ready(p.hash, p.index, need[0], need[1]).catch(() => 0)
        if (pending.current !== p) return
        setTorWarm(have)
        if (have >= 1) swapToTorrent(p)
        return
      }
      // the next episode's opening bytes, fetched well before the end: auto-next starts in the torrent at once
      const n = nextRef.current
      const d = v.duration
      const key = n ? `${tor.key}:${n.id}` : ''
      if (!n || !d || v.currentTime < d * 0.5 || nextWarm.current === key || !torInfo.current) return
      nextWarm.current = key
      const info = await torInfo.current.info.catch(() => null)
      const nf = info && fileFor(info, n)
      if (nf) {
        const [a, b] = torSpan(nf.length / (n.duration || d), 0)
        void bridge.warm(info.infoHash, nf.index, a, b)
      }
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tor])

  // the torrent picked last comes back on its own, for any title that has the same kind
  useEffect(() => {
    const want = local.torrent
    if (tor || !want || source) return
    const t = episodeTorrents.find((x) => torrentTitle(x) === want)
    if (!t) return
    const v = videoRef.current
    if (v && v.currentTime > 0) resumeAt.current = v.currentTime
    setTor(anilibriaSource(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeTorrents])
  useEffect(
    () => () => {
      const f = torFile.current
      if (f) void window.aniplayer?.torrent?.drop(f.hash)
    },
    [],
  )

  // ---------- Anime4K ----------
  // the canvas sits exactly over the letterboxed picture; the video keeps playing underneath
  const [upscaled, setUpscaled] = useState<{ from: number; to: number } | null>(null)
  const [fit, setFit] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !videoSize) return
    const measure = () => {
      const W = wrap.clientWidth
      const H = wrap.clientHeight
      const k = Math.min(W / videoSize.w, H / videoSize.h)
      const w = videoSize.w * k
      const h = videoSize.h * k
      setFit({ x: (W - w) / 2, y: (H - h) / 2, w, h })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [videoSize])

  const upscaleMode = local.upscale
  // the canvas only exists once the picture area is measured
  const hasFit = !!fit
  useEffect(() => {
    const v = videoRef.current
    const c = canvasRef.current
    setUpscaled(null)
    if (upscaleMode === 'off' || !v || !c || !videoSize || !upscaleSupported()) return
    let up: Upscaler | null = null
    let alive = true
    const fail = (e: Error) => {
      if (!alive) return
      setUpscaled(null)
      setToast({ text: `Апскейл недоступен: ${e.message}` })
    }
    startUpscale(v, c, upscaleMode, fail)
      .then((u) => {
        if (!alive) return u.stop()
        up = u
        // the first frames decide the output size; show it once known
        setTimeout(() => alive && setUpscaled(u.info()), 400)
      })
      .catch(fail)
    return () => {
      alive = false
      up?.stop()
    }
  }, [upscaleMode, videoSize, episode.id, quality, hasFit, tor])

  // ---------- saving ----------
  const save = useCallback(
    (force = false) => {
      const v = videoRef.current
      if (ephemeral || !v || session.current.played < 3 || !v.duration) return
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
    // a downloaded episode always plays from the device: works offline and saves traffic
    const off = downloaded(release.id, episode.ordinal)
    const src = off ? { url: offlineUrl(off.key), q: off.quality } : sourceFor(episode, quality)
    // a torrent without this episode (another season's part) hands it back to AniLibria's stream
    if (tor?.anilibria && !off && !episodeTorrents.some((t) => t.id === tor.anilibria!.id)) {
      setTor(null)
      return
    }
    const useTor = off ? null : tor
    setError('')
    if (!src && !useTor) {
      setError('У этой серии нет видео')
      return
    }
    const keepTime = resumeAt.current // set when switching quality
    const wasPlaying = !v.paused || keepTime == null

    const start = async () => {
      let startAt = keepTime ?? 0
      // in a room the position comes from the room, not from this device's history
      if (keepTime == null && !useRoom.getState().code) {
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

      let direct = !off && (nativeHls() || !Hls.isSupported()) ? src?.url : undefined
      pending.current = null
      setTorWarm(null)
      let live = false
      if (useTor) {
        const bridge = window.aniplayer!.torrent!
        try {
          if (torInfo.current?.key !== useTor.key) torInfo.current = { key: useTor.key, info: useTor.open() }
          const info = await torInfo.current.info
          if (cancelled) return
          const f = fileFor(info, episode)
          if (!f) throw new Error(`в раздаче не нашлось ${fmtOrdinal(episode.ordinal)} серии`)
          torFile.current = { hash: info.infoHash, index: f.index }
          setTorCur({ info, file: f })
          const bps = f.length / (episode.duration || v.duration || 1440)
          const [a, b] = torSpan(bps, startAt)
          // already fetched (the next episode, warmed up during this one): straight from the torrent
          const have = await bridge.ready(info.infoHash, f.index, a, Math.min(b, a + Math.max(10 * MB, 12 * bps)))
          if (cancelled) return
          if (have >= 1 || !src) {
            direct = f.url
            live = true
          } else {
            void bridge.warm(info.infoHash, f.index, a, b)
            pending.current = { url: f.url, hash: info.infoHash, index: f.index, bps, warmedTo: b }
            setTorWarm(have)
          }
        } catch (e) {
          if (cancelled) return
          torInfo.current = null
          const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
          // the standalone player has nothing to fall back on
          if (source) return setError(`Торрент не открылся: ${msg}`)
          setToast({ text: `Торрент не открылся: ${msg}` })
          resumeAt.current = startAt
          setTor(null)
          return
        }
      }
      setTorLive(live)
      hlsRef.current?.destroy()
      hlsRef.current = null
      if (direct) {
        v.src = direct
        const onMeta = () => {
          if (startAt) v.currentTime = startAt
          v.removeEventListener('loadedmetadata', onMeta)
        }
        v.addEventListener('loadedmetadata', onMeta)
      } else {
        const hls = new Hls({ startPosition: startAt || -1, maxBufferLength: 45, maxMaxBufferLength: 120, enableWorker: true, loader: OfflineLoader })
        hlsRef.current = hls
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
          else setError('Не удалось загрузить видео')
        })
        hls.loadSource(src!.url)
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
  }, [episode.id, quality, tor])

  // new episode → reset session, save the old one on the way out
  useEffect(() => {
    session.current = { played: 0, lastMedia: -1, pendingWatch: 0, reported: false, skippedOp: false, skippedEd: false, lastSave: 0, ended: false }
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
    v.volume = Number.isFinite(local.volume) ? Math.max(0, Math.min(1, local.volume)) : 1
    v.muted = local.muted
  }, [local.volume, local.muted])

  // ---------- controls visibility ----------
  // an open settings menu keeps the controls up: on a touch screen nothing else would keep extending the timer
  const menuOpen = useRef(false)
  menuOpen.current = menu !== null
  const poke = useCallback(() => {
    setControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused && !menuOpen.current) setControls(false)
    }, 2800)
  }, [])

  useEffect(() => {
    if (!playing) setControls(true)
    else poke()
  }, [playing, poke])

  // closing the menu starts the usual countdown again
  useEffect(() => {
    if (menu === null && playing) poke()
  }, [menu, playing, poke])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  // ---------- watch together ----------
  const report = useRoomPlayback(
    {
      time: () => videoRef.current?.currentTime ?? 0,
      playing: () => !!videoRef.current && !videoRef.current.paused,
      play: () => void videoRef.current?.play().catch(() => {}),
      pause: () => videoRef.current?.pause(),
      seek: (t) => {
        if (videoRef.current) videoRef.current.currentTime = t
      },
    },
    !waiting || time > 0,
  )

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
    setTor(null)
    setLocal({ torrent: '' })
    setQuality(q)
    setPrefs({ quality: q })
    setMenu(null)
  }

  const pickTorrent = (t: Torrent) => {
    resumeAt.current = videoRef.current?.currentTime ?? 0
    setTor(anilibriaSource(t))
    setLocal({ torrent: torrentTitle(t) })
    setMenu(null)
  }

  // a magnet link or .torrent file of the user's own: its episodes are found by number
  const openOwn = (info: TorrentInfo) => {
    setOwnOpen(false)
    if (!fileFor(info, episode)) {
      setToast({ text: `В раздаче не нашлось ${fmtOrdinal(episode.ordinal)} серии` })
      return
    }
    resumeAt.current = videoRef.current?.currentTime ?? 0
    setTor(userSource(info))
  }

  // ---------- dubs inside the file (Electron turns on video.audioTracks) ----------
  type ATrack = { enabled: boolean; label: string; language: string }
  const [audio, setAudio] = useState<{ list: { label: string }[]; cur: number }>({ list: [], cur: 0 })
  const audioPick = useRef<string | null>(null)
  const readAudio = useCallback(() => {
    const tracks = (videoRef.current as (HTMLVideoElement & { audioTracks?: ArrayLike<ATrack> }) | null)?.audioTracks
    if (!tracks) return setAudio({ list: [], cur: 0 })
    const list = Array.from(tracks).map((t, i) => ({ label: trackLabel(t.label, t.language, `Дорожка ${i + 1}`) }))
    // the dub picked in an earlier episode stays picked
    const want = audioPick.current ? list.findIndex((t) => t.label === audioPick.current) : -1
    if (want >= 0 && !tracks[want].enabled) Array.from(tracks).forEach((t, i) => (t.enabled = i === want))
    setAudio({ list, cur: Math.max(0, Array.from(tracks).findIndex((t) => t.enabled)) })
  }, [])
  const selectAudio = (i: number) => {
    const tracks = (videoRef.current as (HTMLVideoElement & { audioTracks?: ArrayLike<ATrack> }) | null)?.audioTracks
    if (!tracks) return
    Array.from(tracks).forEach((t, j) => (t.enabled = j === i))
    audioPick.current = audio.list[i]?.label ?? null
    setAudio((a) => ({ ...a, cur: i }))
    setMenu(null)
  }

  // ---------- subtitles: inside the mkv (read out of the stream) or files next to it ----------
  const [embedded, setEmbedded] = useState<EmbeddedSubs | null>(null)
  const [subPick, setSubPick] = useState<SubPick>(null)
  const [extCues, setExtCues] = useState<Cue[]>([])
  const extSubs = useMemo(() => (torCur ? subsFor(torCur.info, torCur.file, episode.id.startsWith('tf:') ? episodeOf(torCur.file.name) : episode.ordinal) : []), [torCur, episode])
  // the same kind of subtitle file in every episode ("Show - 01.rus.ass", "Show - 02.rus.ass"): numbers aside, one name
  const extKey = (name: string) => name.replace(/\d+/g, '#')
  useEffect(() => {
    setEmbedded(null)
    if (!torCur || !torLive || !/\.mkv$/i.test(torCur.file.name)) return
    let alive = true
    const url = torCur.file.subs
    const load = () =>
      fetch(url)
        .then((r) => r.json())
        .then((e: EmbeddedSubs) => alive && setEmbedded(e))
        .catch(() => {})
    void load()
    const id = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [torCur, torLive])
  useEffect(() => {
    setExtCues([])
    if (subPick?.kind !== 'ext' || !torCur) return
    const f = extSubs.find((x) => extKey(x.name) === subPick.suffix) ?? (extSubs.length === 1 ? extSubs[0] : undefined)
    if (!f) return
    let alive = true
    fetch(f.url)
      .then((r) => r.arrayBuffer())
      .then((b) => alive && setExtCues(parseSubs(f.name, decodeText(b))))
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subPick, extSubs])
  const cues = useMemo(() => (subPick?.kind === 'emb' ? (embedded ? embeddedCues(embedded, subPick.track) : []) : subPick?.kind === 'ext' ? extCues : []), [subPick, embedded, extCues])
  const subTracks = useMemo(
    () => [
      ...(embedded?.tracks ?? []).map((t) => ({ pick: { kind: 'emb', track: t.number } as SubPick, label: trackLabel(t.name, t.language, `Дорожка ${t.number}`) })),
      ...extSubs.map((f) => ({ pick: { kind: 'ext', suffix: extKey(f.name) } as SubPick, label: f.name })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [embedded, extSubs],
  )

  // the bytes around the playhead are on disk: the same second continues from the torrent
  function swapToTorrent(p: NonNullable<typeof pending.current>) {
    const v = videoRef.current
    if (!v) return
    pending.current = null
    const t = v.currentTime
    const wasPlaying = !v.paused
    hlsRef.current?.destroy()
    hlsRef.current = null
    v.src = p.url
    const onMeta = () => {
      v.currentTime = t
      v.removeEventListener('loadedmetadata', onMeta)
    }
    v.addEventListener('loadedmetadata', onMeta)
    if (wasPlaying) v.play().catch(() => {})
    setTorLive(true)
    setTorWarm(null)
  }

  const subLine = cues.filter((c) => time >= c.start && time < c.end).map((c) => c.text)

  const goNext = useCallback(() => {
    if (next) {
      save(true)
      onSelect(next)
    }
  }, [next, onSelect, save])

  // ---------- media events ----------
  const markWatched = useCallback(() => {
    const s = session.current
    if (s.reported || ephemeral) return
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
    if (d && t < d - 3) s.ended = false
    if (d && (t / d >= WATCHED_RATIO || (ed && t >= ed.start!))) markWatched()
  }

  const onEnded = () => {
    if (session.current.ended) return
    session.current.ended = true
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
    // the menu closes only by picking something or by the gear again, not by a stray tap on the picture
    if (menu) return
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

  // ---------- touch gestures (tablets and phones) ----------
  // like a video app rather than a web page: drag sideways to scrub, up and down on the left for brightness
  // and on the right for volume, hold for double speed. A vertical drag on the inline player scrolls the page.
  const [brightness, setBrightness] = useState(1)
  const [gesture, setGesture] = useState<{ kind: 'seek'; to: number; delta: number } | { kind: 'bright' | 'volume'; v: number } | { kind: 'speed' } | null>(null)
  const touch = useRef<{ id: number; x0: number; y0: number; w: number; h: number; mode: null | 'seek' | 'bright' | 'volume' | 'hold'; base: number; to: number; rate: number; hold?: ReturnType<typeof setTimeout> } | null>(null)
  const onSurfaceDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || menu) return
    const r = e.currentTarget.getBoundingClientRect()
    const t = { id: e.pointerId, x0: e.clientX, y0: e.clientY, w: r.width, h: r.height, mode: null, base: 0, to: 0, rate: 1 } as NonNullable<typeof touch.current>
    t.hold = setTimeout(() => {
      const v = videoRef.current
      if (!v || v.paused || touch.current !== t || t.mode) return
      t.mode = 'hold'
      t.rate = v.playbackRate
      v.playbackRate = Math.max(2, t.rate)
      setGesture({ kind: 'speed' })
      navigator.vibrate?.(15)
    }, 450)
    touch.current = t
  }
  const onSurfaceMove = (e: RPointerEvent<HTMLDivElement>) => {
    const t = touch.current
    const v = videoRef.current
    if (!t || t.id !== e.pointerId || !v || t.mode === 'hold') return
    const dx = e.clientX - t.x0
    const dy = e.clientY - t.y0
    if (!t.mode) {
      if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return
      clearTimeout(t.hold)
      if (Math.abs(dx) > Math.abs(dy)) {
        t.mode = 'seek'
        t.base = v.currentTime
      } else {
        // the page scrolls instead while the player is inline (the browser cancels this pointer)
        const left = t.x0 - e.currentTarget.getBoundingClientRect().left < t.w / 2
        t.mode = left || isIOS ? 'bright' : 'volume'
        t.base = t.mode === 'bright' ? brightness : local.muted ? 0 : local.volume
      }
    }
    if (t.mode === 'seek') {
      // the full width is two minutes, or the whole episode when it is shorter
      const span = Math.min(v.duration || 0, 120)
      t.to = Math.max(0, Math.min(v.duration || 0, t.base + (dx / t.w) * span))
      setGesture({ kind: 'seek', to: t.to, delta: t.to - t.base })
    } else {
      const val = Math.max(t.mode === 'bright' ? 0.25 : 0, Math.min(1, t.base - dy / (t.h * 0.7)))
      if (t.mode === 'bright') setBrightness(val)
      else setVolume(val)
      setGesture({ kind: t.mode, v: val })
    }
  }
  const onSurfaceEnd = (e: RPointerEvent<HTMLDivElement>, cancel = false) => {
    const t = touch.current
    if (!t || t.id !== e.pointerId) return onSurfacePointerUp(e)
    touch.current = null
    clearTimeout(t.hold)
    if (t.mode === 'hold') {
      if (videoRef.current) videoRef.current.playbackRate = t.rate
    } else if (t.mode === 'seek' && !cancel) {
      seek(t.to)
      poke()
    } else if (!t.mode && !cancel) onSurfacePointerUp(e)
    setGesture(null)
  }

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

  const trackSize = (v: HTMLVideoElement) => {
    if (v.videoWidth) setVideoSize((s) => (s && s.w === v.videoWidth && s.h === v.videoHeight ? s : { w: v.videoWidth, h: v.videoHeight }))
  }

  const pct = (t: number) => (duration ? (t / duration) * 100 : 0)
  const VolumeIcon = local.muted || local.volume === 0 ? VolumeX : local.volume < 0.5 ? Volume1 : Volume2
  const poster = episodePreview(episode)

  return (
    <div
      ref={wrapRef}
      className={cn(
        'group/player @container-size relative w-full overflow-hidden bg-black select-none',
        fullscreen ? 'h-full' : 'aspect-video rounded-3xl shadow-2xl shadow-black/60 ring-1 ring-white/5',
        !controls && playing && 'cursor-none',
      )}
      onPointerMove={(e) => e.pointerType === 'mouse' && poke()}
      // a touch on any control (button, slider, menu) counts as activity, like a mouse move does
      onPointerDownCapture={(e) => e.pointerType !== 'mouse' && (e.target as HTMLElement).closest('button, input, [role="slider"], [data-controls]') && poke()}
      onMouseLeave={() => playing && !menuOpen.current && setControls(false)}
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full"
        poster={poster}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        onPlay={() => {
          setPlaying(true)
          report()
        }}
        onPause={() => {
          setPlaying(false)
          save(true)
          report()
        }}
        onWaiting={(e) => {
          setWaiting(true)
          // the stream can stop a moment short of its stated length and never say "ended"
          const v = e.currentTarget
          if (v.duration && v.currentTime >= v.duration - 1.5) onEnded()
        }}
        onCanPlay={() => setWaiting(false)}
        onPlaying={() => setWaiting(false)}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration)
          trackSize(e.currentTarget)
          readAudio()
        }}
        onResize={(e) => trackSize(e.currentTarget)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={onTimeUpdate}
        onSeeked={() => {
          save(true)
          report()
        }}
        onEnded={onEnded}
        onError={() => !hlsRef.current && setError(torLive ? 'Видео из торрента не воспроизводится на этом компьютере' : 'Не удалось воспроизвести видео')}
      />

      {upscaleMode !== 'off' && fit && (
        <canvas
          ref={canvasRef}
          className={cn('pointer-events-none absolute transition-opacity duration-300', upscaled ? 'opacity-100' : 'opacity-0')}
          style={{ left: fit.x, top: fit.y, width: fit.w, height: fit.h }}
        />
      )}

      {/* tap / click surface */}
      <div
        className={cn('absolute inset-0', fullscreen ? 'touch-none' : 'touch-pan-y')}
        onPointerDown={onSurfaceDown}
        onPointerMove={onSurfaceMove}
        onPointerUp={(e) => onSurfaceEnd(e)}
        onPointerCancel={(e) => onSurfaceEnd(e, true)}
        onContextMenu={(e) => isTouch && e.preventDefault()}
      />
      {brightness < 1 && <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: 1 - brightness }} />}

      {/* what a drag is doing */}
      {gesture && (
        <div className="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center">
          <div className="animate-fade-in glass flex items-center gap-3 rounded-2xl px-5 py-3 text-lg font-extrabold tabular-nums ring-1 ring-white/10">
            {gesture.kind === 'seek' ? (
              <>
                {gesture.delta < 0 ? <RotateCcw size={20} /> : <RotateCw size={20} />}
                {fmtTime(gesture.to)}
                <span className="text-sm font-bold text-white/60">
                  {gesture.delta < 0 ? '−' : '+'}
                  {fmtTime(Math.abs(gesture.delta))}
                </span>
              </>
            ) : gesture.kind === 'speed' ? (
              <>
                <FastForward size={20} fill="currentColor" /> ×2
              </>
            ) : (
              <>
                {gesture.kind === 'bright' ? <Sun size={20} /> : <Volume2 size={20} />}
                <span className="h-1.5 w-32 overflow-hidden rounded-full bg-white/20">
                  <span className="block h-full rounded-full bg-white" style={{ width: `${Math.round(gesture.v * 100)}%` }} />
                </span>
              </>
            )}
          </div>
        </div>
      )}

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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
          <p className="text-lg font-semibold">{error}</p>
          {!source && <button
            className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black"
            onClick={() => {
              resumeAt.current = videoRef.current?.currentTime ?? 0
              if (tor) setTor(null)
              else setQuality((q) => (q === '1080' ? '720' : q === '720' ? '480' : '1080'))
            }}
          >
            {tor ? 'Смотреть с AniLibria' : 'Попробовать другое качество'}
          </button>}
        </div>
      )}

      {/* touch: ⟲ ▶ ⟳ in the middle while the controls show, like a video app */}
      {isTouch && (fullscreen || (fit?.h ?? 0) >= 330) && !error && countdown == null && !gesture && (controls || !playing) && (
        <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-[clamp(28px,9cqw,96px)]">
          <button className="flex h-14 w-14 items-center justify-center rounded-full bg-black/35 backdrop-blur-md active:scale-90" onClick={() => (seekBy(-10), poke())} aria-label="Назад 10 секунд">
            <RotateCcw size={26} />
          </button>
          <button
            className="flex h-20 w-20 items-center justify-center rounded-full bg-white/95 text-black shadow-2xl transition active:scale-90"
            onClick={() => (togglePlay(), poke())}
            aria-label={playing ? 'Пауза' : 'Смотреть'}
          >
            {waiting && playing ? <Loader2 size={32} className="animate-spin" /> : playing ? <Pause size={32} fill="currentColor" /> : <Play size={34} fill="currentColor" className="ml-1" />}
          </button>
          <button className="flex h-14 w-14 items-center justify-center rounded-full bg-black/35 backdrop-blur-md active:scale-90" onClick={() => (seekBy(10), poke())} aria-label="Вперёд 10 секунд">
            <RotateCw size={26} />
          </button>
        </div>
      )}

      {/* big center play */}
      {!(isTouch && (fullscreen || (fit?.h ?? 0) >= 330)) && !playing && !waiting && !error && countdown == null && (
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
        {tor && (
          <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-white/70">
            <Magnet size={13} className="text-accent-2" /> Торрент · <span className="max-w-[40ch] truncate">{tor.title}</span>
            {!torLive && torWarm != null && ` · готовим, ${Math.round(torWarm * 100)}%`}
            {torStats && ` · ${torStats.peers} пир. · ${(torStats.down / 1024 ** 2).toFixed(1)} МБ/с`}
          </div>
        )}
      </div>

      {/* subtitles */}
      {subLine.length > 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 flex justify-center px-[6%] text-center transition-[bottom] duration-300"
          style={{ bottom: controls || menu ? 150 : '6%' }}
        >
          <div className="text-[clamp(15px,4.6cqh,46px)] leading-tight font-bold whitespace-pre-line text-white [text-shadow:0_0_3px_#000,0_0_3px_#000,0_2px_6px_#000]">
            {subLine.join('\n')}
          </div>
        </div>
      )}

      {/* own torrent: a magnet link or a .torrent file */}
      {ownOpen && (
        <div className="animate-fade-in absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onPointerUp={(e) => e.stopPropagation()}>
          <div className="w-full max-w-lg rounded-3xl bg-card p-5 ring-1 ring-white/10">
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-lg font-extrabold">
                <Magnet size={18} className="text-accent-2" /> Свой торрент
              </div>
              <button onClick={() => setOwnOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10" aria-label="Закрыть">
                <X size={16} />
              </button>
            </div>
            <p className="mb-4 text-sm text-white/60">
              Вставьте magnet-ссылку или выберите .torrent файл. Серии найдутся по номерам в именах файлов, озвучка и субтитры из MKV — в настройках плеера.
            </p>
            <TorrentOpenForm onOpen={openOwn} />
          </div>
        </div>
      )}

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
                torrents={episodeTorrents}
                tor={tor}
                pickTorrent={pickTorrent}
                hasStream={!source}
                onOwn={
                  torrentSupported() && !source
                    ? () => {
                        setMenu(null)
                        setOwnOpen(true)
                      }
                    : undefined
                }
                audio={audio}
                selectAudio={selectAudio}
                subTracks={subTracks}
                subPick={subPick}
                setSubPick={(p) => {
                  setSubPick(p)
                  setMenu(null)
                }}
                rate={local.rate}
                setRate={setRate}
                upscale={upscaleMode}
                setUpscale={(m) => {
                  setLocal({ upscale: m })
                  setMenu(null)
                }}
              />
            )}
            <div className="glass flex items-center gap-0.5 rounded-2xl p-1.5 ring-1 ring-white/10">
              <CtrlBtn label="Настройки" onClick={() => setMenu(menu ? null : 'main')} active={!!menu}>
                <Settings size={19} className={cn('transition-transform duration-300', menu && 'rotate-45')} />
              </CtrlBtn>
              <span className="hidden items-center gap-1 px-1.5 text-xs font-bold text-white/70 sm:flex">
                {offline ? 'Скачано' : torLive ? 'Торрент' : `${quality}p`}
                {upscaled && (
                  <span
                    className="flex items-center gap-0.5 rounded-md bg-gradient-to-r from-accent to-pink px-1.5 py-0.5 text-[10px] font-extrabold text-white"
                    title={upscaled.to > upscaled.from ? `Anime4K: ${upscaled.from}p → ${upscaled.to}p` : 'Anime4K: чистка линий и резкость'}
                  >
                    <Sparkles size={10} /> {upscaled.to >= 2000 ? '4K' : upscaled.to >= 1400 ? '2K' : 'A4K'}
                  </span>
                )}
              </span>
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
            className={cn('group/bar relative flex flex-1 cursor-pointer touch-none items-center', isTouch ? 'h-9' : 'h-5')}
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
                'absolute -translate-x-1/2 rounded-full bg-white shadow-lg shadow-black/50 transition-transform',
                isTouch ? 'h-5 w-5' : 'h-4 w-4',
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
  torrents,
  tor,
  pickTorrent,
  hasStream,
  onOwn,
  audio,
  selectAudio,
  subTracks,
  subPick,
  setSubPick,
  rate,
  setRate,
  upscale,
  setUpscale,
}: {
  menu: Menu
  setMenu: (m: null | Menu) => void
  episode: Episode
  quality: Quality
  changeQuality: (q: Quality) => void
  torrents: Torrent[]
  tor: TorSource | null
  pickTorrent: (t: Torrent) => void
  hasStream: boolean
  onOwn?: () => void
  audio: { list: { label: string }[]; cur: number }
  selectAudio: (i: number) => void
  subTracks: { pick: SubPick; label: string }[]
  subPick: SubPick
  setSubPick: (p: SubPick) => void
  rate: number
  setRate: (r: number) => void
  upscale: UpscaleMode
  setUpscale: (m: UpscaleMode) => void
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
      className="animate-pop glass absolute right-0 bottom-full mb-2 max-h-[calc(100cqh-156px)] w-72 overflow-y-auto overscroll-contain rounded-2xl p-2 text-sm shadow-2xl ring-1 ring-white/10"
      onPointerUp={(e) => e.stopPropagation()}
    >
      {menu === 'main' && (
        <>
          {hasStream && <Row label="Качество" value={tor ? 'Торрент' : `${quality}p`} onClick={() => setMenu('quality')} />}
          {audio.list.length > 1 && <Row label="Озвучка" value={audio.list[audio.cur]?.label ?? ''} onClick={() => setMenu('audio')} />}
          {subTracks.length > 0 && (
            <Row label="Субтитры" value={subPick ? (subTracks.find((t) => samePick(t.pick, subPick))?.label ?? 'Вкл') : 'Выкл'} onClick={() => setMenu('subs')} />
          )}
          <Row label="Скорость" value={rate === 1 ? 'Обычная' : `${rate}×`} onClick={() => setMenu('speed')} />
          {upscaleSupported() ? (
            <Row label="Апскейл Anime4K" value={UPSCALE_MODES.find((m) => m.id === upscale)!.label} onClick={() => setMenu('upscale')} />
          ) : (
            <div className="flex items-center justify-between gap-6 rounded-xl px-3 py-2.5 text-white/40">
              <span className="font-semibold">Апскейл Anime4K</span>
              <span className="text-right text-xs">Недоступно на этом устройстве</span>
            </div>
          )}
          <div className="my-1 h-px bg-white/10" />
          <Toggle label="Пропускать опенинг" on={prefs.autoSkipOpening} set={(v) => setPrefs({ autoSkipOpening: v })} />
          <Toggle label="Пропускать эндинг" on={prefs.autoSkipEnding} set={(v) => setPrefs({ autoSkipEnding: v })} />
          <Toggle label="Автопереход" on={prefs.autoNext} set={(v) => setPrefs({ autoNext: v })} />
          <Toggle label="Пропускать филлеры" on={!!prefs.skipFillers} set={(v) => setPrefs({ skipFillers: v })} />
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
              {!tor && q === quality && <Check size={18} className="text-accent-2" />}
            </button>
          ))}
          {torrents.length > 0 && (
            <>
              <div className="mx-3 mt-2 mb-1 flex items-center gap-1.5 border-t border-white/10 pt-2.5 text-xs font-bold text-white/50">
                <Magnet size={13} /> Торрент · максимальное качество
              </div>
              {torrents.map((t) => (
                <button key={t.id} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/10" onClick={() => pickTorrent(t)}>
                  <span>
                    <span className="block font-semibold">{torrentTitle(t)}</span>
                    <span className="block text-xs text-white/50">{torrentHint(t)}</span>
                  </span>
                  {tor?.anilibria?.id === t.id && <Check size={18} className="shrink-0 text-accent-2" />}
                </button>
              ))}
            </>
          )}
          {onOwn && (
            <button className="mt-1 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/10" onClick={onOwn}>
              <span>
                <span className="flex items-center gap-1.5 font-semibold">
                  <Magnet size={14} /> Свой торрент
                </span>
                <span className="block text-xs text-white/50">{tor && !tor.anilibria ? tor.title : 'Magnet-ссылка или файл .torrent'}</span>
              </span>
              {tor && !tor.anilibria ? <Check size={18} className="shrink-0 text-accent-2" /> : <ChevronRight size={16} className="text-white/60" />}
            </button>
          )}
        </>
      )}
      {menu === 'upscale' && (
        <>
          <Back title="Апскейл Anime4K" />
          {UPSCALE_MODES.map((m) => (
            <button
              key={m.id}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/10"
              onClick={() => setUpscale(m.id)}
            >
              <span>
                <span className="block font-semibold">{m.label}</span>
                <span className="block text-xs text-white/50">{m.hint}</span>
              </span>
              {m.id === upscale && <Check size={18} className="shrink-0 text-accent-2" />}
            </button>
          ))}
        </>
      )}
      {menu === 'audio' && (
        <>
          <Back title="Озвучка" />
          {audio.list.map((t, i) => (
            <button key={i} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/10" onClick={() => selectAudio(i)}>
              <span className="font-semibold">{t.label}</span>
              {i === audio.cur && <Check size={18} className="shrink-0 text-accent-2" />}
            </button>
          ))}
        </>
      )}
      {menu === 'subs' && (
        <>
          <Back title="Субтитры" />
          {[{ pick: null as SubPick, label: 'Выкл' }, ...subTracks].map((t, i) => (
            <button key={i} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/10" onClick={() => setSubPick(t.pick)}>
              <span className="min-w-0 truncate font-semibold">{t.label}</span>
              {samePick(t.pick, subPick) && <Check size={18} className="shrink-0 text-accent-2" />}
            </button>
          ))}
        </>
      )}
      {menu === 'speed' && (
        <>
          <Back title="Скорость" />
          {RATES.map((r) => (
            <button key={r} className="flex w-full items-center justify-between rounded-xl px-3 py-2 hover:bg-white/10" onClick={() => {
                setRate(r)
                setMenu(null)
              }}>
              <span className="font-semibold">{r === 1 ? 'Обычная' : `${r}×`}</span>
              {r === rate && <Check size={18} className="text-accent-2" />}
            </button>
          ))}
        </>
      )}
    </div>
  )
}
