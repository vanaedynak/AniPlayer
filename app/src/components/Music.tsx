import { useEffect, useMemo, useRef, useState } from 'react'
import { Music2, Play, Pause, SkipForward, SkipBack, X, Video, VideoOff, ListMusic, Loader2 } from 'lucide-react'
import { themesFor, useMusic, currentTheme, type Theme } from '../lib/themes'
import { useAsync } from '../lib/useAsync'
import { Section } from './ui'
import { cn } from '../lib/format'

const canOgg = typeof document !== 'undefined' && !!document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"')
// audio only = the light .ogg; with the picture (or where .ogg won't play) the .webm clip
const srcFor = (t: Theme, video: boolean) => (!video && canOgg && t.audio ? t.audio : t.video)

/** "Опенинги и эндинги" block on a title page */
export function ThemesSection({ malId }: { malId: number }) {
  const { data } = useAsync(() => themesFor(malId), [malId])
  const music = useMusic()
  const cur = currentTheme(music)
  if (!data?.length) return null
  return (
    <Section
      title={
        <span className="flex items-center gap-2.5">
          <Music2 className="text-pink" /> Опенинги и эндинги
        </span>
      }
      action={
        <button className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/15" onClick={() => music.play(data)}>
          <Play size={16} fill="currentColor" /> Слушать все
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((t, i) => {
          const active = cur?.id === t.id
          return (
            <button
              key={t.id}
              onClick={() => (active ? music.toggle() : music.play(data, i))}
              className={cn(
                'group flex items-center gap-4 rounded-2xl border p-3 text-left transition',
                active ? 'border-pink/40 bg-pink/10' : 'border-white/[0.06] bg-card/70 hover:border-white/15 hover:bg-card-2',
              )}
            >
              <div
                className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold',
                  t.kind === 'OP' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-orange-500/15 text-orange-300',
                )}
              >
                {active && music.playing ? <Equalizer /> : t.slug}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{t.song}</div>
                <div className="truncate text-sm text-muted">{t.artists || (t.kind === 'OP' ? 'Опенинг' : 'Эндинг')}</div>
                {t.episodes && <div className="text-xs font-semibold text-dim">Серии {t.episodes}</div>}
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black opacity-0 transition group-hover:opacity-100">
                {active && music.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
              </span>
            </button>
          )
        })}
      </div>
    </Section>
  )
}

/** plays the openings of every title in a list, one after another */
export function PlaylistButton({ malIds, label = 'Опенинги коллекции' }: { malIds: number[]; label?: string }) {
  const play = useMusic((s) => s.play)
  const [busy, setBusy] = useState(false)
  if (!malIds.length) return null
  return (
    <button
      disabled={busy}
      className="flex items-center gap-2 rounded-full bg-gradient-to-r from-accent to-pink px-4 py-2 text-sm font-extrabold shadow-lg shadow-accent/25 transition hover:scale-[1.03] disabled:opacity-60"
      onClick={async () => {
        setBusy(true)
        const lists = await Promise.all(malIds.slice(0, 40).map((id) => themesFor(id)))
        setBusy(false)
        const ops = lists.flatMap((l) => l.filter((t) => t.kind === 'OP'))
        // shuffle so a long collection doesn't always start with the same show
        for (let i = ops.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[ops[i], ops[j]] = [ops[j], ops[i]]
        }
        if (ops.length) play(ops)
      }}
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <ListMusic size={16} />} {label}
    </button>
  )
}

function Equalizer() {
  return (
    <span className="flex h-4 items-end gap-0.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="eq-bar w-1 rounded-full bg-current" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  )
}

/** floating player that survives navigation; lives in Layout */
export function MiniPlayer() {
  const music = useMusic()
  const t = currentTheme(music)
  const ref = useRef<HTMLVideoElement>(null)
  const [progress, setProgress] = useState(0)
  const src = useMemo(() => (t ? srcFor(t, music.video) : ''), [t, music.video])

  // switching between audio and clip keeps the position
  const keep = useRef(0)
  useEffect(() => {
    const v = ref.current
    if (!v || !src) return
    const at = keep.current
    keep.current = 0
    if (at) v.addEventListener('loadedmetadata', () => (v.currentTime = at), { once: true })
  }, [src])

  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (music.playing) v.play().catch(() => music.setPlaying(false))
    else v.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [music.playing, src])

  // lock screen / headphone buttons
  useEffect(() => {
    if (!t || !('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.song, artist: t.artists, album: `${t.anime} · ${t.slug}`, artwork: t.cover ? [{ src: t.cover }] : [] })
    navigator.mediaSession.setActionHandler('play', () => useMusic.getState().setPlaying(true))
    navigator.mediaSession.setActionHandler('pause', () => useMusic.getState().setPlaying(false))
    navigator.mediaSession.setActionHandler('nexttrack', () => useMusic.getState().next())
    navigator.mediaSession.setActionHandler('previoustrack', () => useMusic.getState().prev())
  }, [t])

  if (!t) return null
  return (
    <div
      className={cn(
        'glass animate-pop fixed right-4 z-50 overflow-hidden rounded-3xl shadow-2xl shadow-black/60 ring-1 ring-white/10 lg:bottom-6',
        music.video ? 'w-[min(420px,calc(100vw-2rem))]' : 'w-[min(360px,calc(100vw-2rem))]',
      )}
      style={{ bottom: 'calc(max(var(--safe-bottom), 8px) + 76px)' }}
    >
      <video
        ref={ref}
        src={src}
        playsInline
        className={cn('w-full bg-black', music.video ? 'aspect-video' : 'hidden')}
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
        onEnded={() => music.next()}
        onPlay={() => !music.playing && music.setPlaying(true)}
        onPause={(e) => !e.currentTarget.ended && music.playing && music.setPlaying(false)}
        onError={() => music.next()}
      />
      <div className="flex items-center gap-3 p-3">
        {t.cover ? <img src={t.cover} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : <Music2 className="h-12 w-12 shrink-0 p-3" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{t.song}</div>
          <div className="truncate text-xs text-muted">
            {t.anime} · {t.slug}
            {t.artists ? ` · ${t.artists}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          {music.index > 0 && (
            <button className="p-2 text-white/80 hover:text-white" onClick={music.prev} aria-label="Предыдущий">
              <SkipBack size={18} fill="currentColor" />
            </button>
          )}
          <button className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black" onClick={music.toggle} aria-label={music.playing ? 'Пауза' : 'Играть'}>
            {music.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
          </button>
          {music.index < music.queue.length - 1 && (
            <button className="p-2 text-white/80 hover:text-white" onClick={music.next} aria-label="Следующий">
              <SkipForward size={18} fill="currentColor" />
            </button>
          )}
          <button
            className="p-2 text-white/60 hover:text-white"
            title={music.video ? 'Только звук' : 'Показать клип'}
            onClick={() => {
              keep.current = ref.current?.currentTime ?? 0
              music.setVideo(!music.video)
            }}
          >
            {music.video ? <VideoOff size={17} /> : <Video size={17} />}
          </button>
          <button className="p-2 text-white/60 hover:text-white" onClick={music.close} aria-label="Закрыть">
            <X size={17} />
          </button>
        </div>
      </div>
      <div className="h-0.5 bg-white/10">
        <div className="h-full bg-gradient-to-r from-accent to-pink" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  )
}
