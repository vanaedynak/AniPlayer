import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Users, Copy, Check, LogOut, MessageCircle, Send, X, Loader2 } from 'lucide-react'
import { type RoomEvent, useRoom, createRoom, joinRoom, leaveRoom, publishPath, publishPlayback, sendEvent, resumeRoom, myUid, roomTime, onlineMembers } from '../lib/room'
import { useSync } from '../lib/sync'
import { cn } from '../lib/format'

const EMOJI = ['😂', '❤️', '😮', '🔥', '👏', '😭']
const isWatchPath = (p: string) => p.startsWith('/watch/') || p.startsWith('/anime/')

export interface PlaybackAdapter {
  time: () => number
  playing: () => boolean
  play: () => void
  pause: () => void
  seek: (t: number) => void
}

/** connects a player to the room: applies what others do, and returns `report` for our own actions */
export function useRoomPlayback(adapter: PlaybackAdapter, ready: boolean) {
  const code = useRoom((s) => s.code)
  const ad = useRef(adapter)
  ad.current = adapter
  // changes we apply from the room fire media events too; don't send them back
  const quietUntil = useRef(0)
  const applied = useRef(0)

  useEffect(() => {
    if (!code || !ready) return
    const apply = () => {
      const r = useRoom.getState().room
      if (!r || r.at <= applied.current) return
      applied.current = r.at
      if (r.by === myUid()) {
        // a room we just created from a running episode starts where we are
        if (r.time === 0 && ad.current.time() > 1) publishPlayback({ time: ad.current.time(), playing: ad.current.playing() }, true)
        return
      }
      quietUntil.current = Date.now() + 1500
      const target = roomTime(r)
      if (Math.abs(ad.current.time() - target) > 2) ad.current.seek(target)
      if (r.playing && !ad.current.playing()) ad.current.play()
      else if (!r.playing && ad.current.playing()) ad.current.pause()
    }
    apply()
    return useRoom.subscribe((s, p) => s.room !== p.room && apply())
  }, [code, ready])

  return useCallback(
    (force = true) => {
      if (!useRoom.getState().code || Date.now() < quietUntil.current) return
      publishPlayback({ time: ad.current.time(), playing: ad.current.playing() }, force)
    },
    [],
  )
}

/** keeps everyone on the same episode; lives in Layout */
export function RoomBridge() {
  const loc = useLocation()
  const nav = useNavigate()
  const room = useRoom((s) => s.room)
  const code = useRoom((s) => s.code)
  const user = useSync((s) => s.user)
  const here = loc.pathname + loc.search
  const lastRoomPath = useRef<string | null>(null)

  useEffect(() => {
    if (user) resumeRoom()
  }, [user])

  // the room moved to another episode (or we just joined): follow
  useEffect(() => {
    if (!room) return
    if (room.path !== lastRoomPath.current) {
      lastRoomPath.current = room.path
      if (room.path !== here) nav(room.path)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.path])

  // we picked another episode: lead
  useEffect(() => {
    if (!code || !room || here === room.path || !isWatchPath(loc.pathname)) return
    lastRoomPath.current = here
    publishPath(here, document.title)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here])

  return code ? (
    <>
      <RoomBar />
      <ReactionLayer />
    </>
  ) : null
}

/** header button: create a room from the current episode or join one by code */
export function RoomButton() {
  const code = useRoom((s) => s.code)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Смотреть вместе"
        className={cn('no-drag relative flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10', code && 'text-accent-2')}
      >
        <Users size={20} />
        {code && <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-emerald-400" />}
      </button>
      {open && <RoomDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function RoomDialog({ onClose }: { onClose: () => void }) {
  const loc = useLocation()
  const user = useSync((s) => s.user)
  const code = useRoom((s) => s.code)
  const room = useRoom((s) => s.room)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const canCreate = isWatchPath(loc.pathname)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setErr('')
    try {
      await fn()
    } catch (e) {
      const m = (e as Error).message
      setErr(m.includes('permission') ? 'Нет доступа к комнатам: в Firebase нужно обновить правила (SETUP.md)' : m)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="animate-pop w-full max-w-md rounded-[28px] border border-white/10 bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-pink">
              <Users />
            </div>
            <div>
              <div className="text-xl font-extrabold">Смотреть вместе</div>
              <div className="text-sm text-muted">Пауза, перемотка и серии — у всех одновременно</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        {!user ? (
          <p className="text-sm text-white/80">Чтобы создать комнату или войти в неё, войдите в аккаунт: Настройки → Синхронизация.</p>
        ) : code ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl bg-white/[0.04] p-4 text-center ring-1 ring-white/5">
              <div className="text-xs font-bold tracking-widest text-muted uppercase">Код комнаты</div>
              <div className="mt-1 font-mono text-4xl font-extrabold tracking-[0.3em]">{code}</div>
              <div className="mt-1 text-sm text-muted">Друг вводит этот код в AniPlayer: значок 👥 сверху</div>
            </div>
            <div className="text-sm text-white/80">
              В комнате: {onlineMembers(room).map((m) => m.name).join(', ') || '…'}
            </div>
            <div className="flex gap-2">
              <button
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-white font-bold text-black"
                onClick={() => {
                  void navigator.clipboard?.writeText(code)
                  setCopied(true)
                }}
              >
                {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? 'Скопировано' : 'Копировать код'}
              </button>
              <button
                className="flex h-12 items-center gap-2 rounded-2xl bg-white/10 px-5 font-bold hover:bg-white/15"
                onClick={() => {
                  void leaveRoom()
                  onClose()
                }}
              >
                <LogOut size={18} /> Выйти
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <button
              disabled={!canCreate || busy}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-white font-bold text-black disabled:opacity-40"
              onClick={() => run(() => createRoom(loc.pathname + loc.search, document.title, 0, false))}
            >
              {busy ? <Loader2 className="animate-spin" size={18} /> : <Users size={18} />} Создать комнату с этой серией
            </button>
            {!canCreate && <div className="-mt-2 text-center text-xs text-muted">Откройте серию, чтобы создать комнату</div>}
            <div className="flex items-center gap-3 text-xs font-bold text-dim">
              <div className="h-px flex-1 bg-white/10" /> ИЛИ <div className="h-px flex-1 bg-white/10" />
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void run(() => joinRoom(input))
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value.toUpperCase())}
                placeholder="Код друга"
                maxLength={6}
                autoCapitalize="characters"
                className="h-12 min-w-0 flex-1 rounded-2xl bg-white/[0.06] px-4 font-mono text-lg font-bold tracking-[0.2em] ring-1 ring-white/10 outline-none focus:ring-accent"
              />
              <button disabled={input.length < 6 || busy} className="h-12 rounded-2xl bg-accent px-5 font-bold disabled:opacity-40">
                Войти
              </button>
            </form>
          </div>
        )}
        {err && <div className="mt-3 text-sm font-semibold text-rose-400">{err}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** floating room strip: who's here, reactions, chat */
function RoomBar() {
  const { code, room, events, error } = useRoom()
  const [chat, setChat] = useState(false)
  const [text, setText] = useState('')
  const [seen, setSeen] = useState(0)
  const members = onlineMembers(room)
  const chats = events.filter((e) => e.kind === 'chat')
  const unread = chat ? 0 : chats.filter((e) => e.at > seen && e.uid !== myUid()).length
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (chat) {
      setSeen(Date.now())
      listRef.current?.scrollTo({ top: 1e9 })
    }
  }, [chat, chats.length])

  return (
    <div className="fixed bottom-[calc(max(var(--safe-bottom),8px)+76px)] left-4 z-50 flex flex-col items-start gap-2 lg:bottom-6">
      {chat && (
        <div className="glass animate-pop flex w-[min(320px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl ring-1 ring-white/10">
          <div ref={listRef} className="flex max-h-64 flex-col gap-2 overflow-y-auto p-3">
            {chats.length ? (
              chats.map((e) => (
                <div key={e.id} className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm', e.uid === myUid() ? 'self-end bg-accent/80' : 'bg-white/10')}>
                  {e.uid !== myUid() && <div className="text-xs font-bold text-accent-2">{e.name}</div>}
                  {e.text}
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-sm text-muted">Сообщений пока нет</div>
            )}
          </div>
          <form
            className="flex gap-2 border-t border-white/10 p-2"
            onSubmit={(e) => {
              e.preventDefault()
              sendEvent('chat', text)
              setText('')
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Сообщение…" className="min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3 text-sm outline-none" />
            <button className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-black">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
      <div className="glass flex items-center gap-1 rounded-full p-1.5 ring-1 ring-white/10">
        <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-extrabold" title={members.map((m) => m.name).join(', ')}>
          <span className="h-2 w-2 rounded-full bg-emerald-400" /> {code} · {members.length}
        </span>
        {EMOJI.map((e) => (
          <button key={e} className="rounded-full px-1.5 py-1 text-lg transition hover:scale-125" onClick={() => sendEvent('emoji', e)}>
            {e}
          </button>
        ))}
        <button className="relative rounded-full p-2 hover:bg-white/10" onClick={() => setChat(!chat)} title="Чат">
          <MessageCircle size={18} />
          {unread > 0 && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-pink px-1.5 text-[10px] font-extrabold">{unread}</span>}
        </button>
      </div>
      {error && <div className="glass rounded-2xl px-3 py-2 text-xs font-semibold text-rose-300">{error}</div>}
    </div>
  )
}

/** reactions float up over the page — and over the player in fullscreen */
function ReactionLayer() {
  const events = useRoom((s) => s.events)
  const [items, setItems] = useState<{ id: string; text: string; kind: RoomEvent['kind']; name: string; x: number }[]>([])
  const [host, setHost] = useState<Element>(document.body)
  const shown = useRef(new Set<string>())
  const since = useRef(Date.now())

  useEffect(() => {
    const fresh = events.filter((e) => e.at > since.current - 2000 && !shown.current.has(e.id) && (e.kind === 'emoji' || e.uid !== myUid()))
    if (!fresh.length) return
    fresh.forEach((e) => shown.current.add(e.id))
    const add = fresh.map((e) => ({ id: e.id, text: e.text, kind: e.kind, name: e.name, x: 8 + Math.random() * 30 }))
    setItems((l) => [...l, ...add])
    const t = setTimeout(() => setItems((l) => l.filter((i) => !add.includes(i))), 4500)
    return () => clearTimeout(t)
  }, [events])

  useEffect(() => {
    const on = () => {
      const d = document as Document & { webkitFullscreenElement?: Element }
      setHost(d.fullscreenElement ?? d.webkitFullscreenElement ?? document.body)
    }
    document.addEventListener('fullscreenchange', on)
    document.addEventListener('webkitfullscreenchange', on)
    return () => {
      document.removeEventListener('fullscreenchange', on)
      document.removeEventListener('webkitfullscreenchange', on)
    }
  }, [])

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[90] overflow-hidden">
      {items.map((i) =>
        i.kind === 'emoji' ? (
          <span key={i.id} className="float-up absolute bottom-24 text-5xl" style={{ left: `${i.x}%` }}>
            {i.text}
          </span>
        ) : (
          <div key={i.id} className="animate-pop glass absolute top-20 left-1/2 max-w-sm -translate-x-1/2 rounded-2xl px-4 py-2.5 text-sm ring-1 ring-white/10">
            <span className="font-bold text-accent-2">{i.name}:</span> {i.text}
          </div>
        ),
      )}
    </div>,
    host,
  )
}
