// Watch together: a row per room keeps the episode, position and play state; room_events carries
// reactions and chat; who is in the room comes from realtime presence. Everyone in the room may drive playback.
import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { cloud, useSync, accountName } from './sync'

export interface RoomDoc {
  path: string
  title: string
  time: number
  playing: boolean
  /** Date.now() when `time` was measured, to extrapolate a running video */
  at: number
  by: string
  members: Record<string, { name: string; seen: number }>
  createdAt: number
}

export interface RoomEvent {
  id: string
  kind: 'emoji' | 'chat'
  text: string
  name: string
  uid: string
  at: number
}

interface RoomState {
  code: string | null
  room: RoomDoc | null
  events: RoomEvent[]
  error: string
}

export const useRoom = create<RoomState>(() => ({ code: null, room: null, events: [], error: '' }))

const CODE_KEY = 'aniplayer-room'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O, 1/I
let channel: RealtimeChannel | null = null
let members: RoomDoc['members'] = {}

const myName = () => accountName(useSync.getState().user) || 'Гость'

function need() {
  const c = cloud()
  if (!c) throw new Error('Войдите в аккаунт (Настройки → Синхронизация), чтобы смотреть вместе')
  return c
}

type Row = { code: string; data: Omit<RoomDoc, 'members'> }
type EventRow = { id: number; kind: RoomEvent['kind']; text: string; name: string; uid: string; at: number }

const setRoom = (data: Omit<RoomDoc, 'members'>) => useRoom.setState({ room: { ...data, members } })

export async function createRoom(path: string, title: string, time: number, playing: boolean) {
  const { sb, uid } = need()
  const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join('')
  const data = { path, title, time, playing, at: Date.now(), by: uid, createdAt: Date.now() }
  const { error } = await sb.from('rooms').insert({ code, data })
  if (error) throw new Error(error.message)
  listen(code, data)
  return code
}

export async function joinRoom(raw: string) {
  const { sb } = need()
  const code = raw.trim().toUpperCase()
  const { data } = await sb.from('rooms').select('data').eq('code', code).maybeSingle()
  if (!data) throw new Error('Комната не найдена — проверьте код')
  listen(code, data.data as Row['data'])
  return { ...(data.data as Row['data']), members } as RoomDoc
}

export async function leaveRoom() {
  stop()
  useRoom.setState({ code: null, room: null, events: [], error: '' })
  localStorage.removeItem(CODE_KEY)
}

function stop() {
  const c = cloud()
  if (channel && c) void c.sb.removeChannel(channel)
  channel = null
  members = {}
}

function listen(code: string, data: Row['data']) {
  const c = cloud()
  if (!c) return
  stop()
  localStorage.setItem(CODE_KEY, code)
  useRoom.setState({ code, error: '', events: [] })
  setRoom(data)
  void c.sb
    .from('room_events')
    .select('id,kind,text,name,uid,at')
    .eq('code', code)
    .order('id', { ascending: false })
    .limit(40)
    .then(({ data: rows }) => useRoom.setState({ events: ((rows ?? []) as EventRow[]).reverse().map((r) => ({ ...r, id: String(r.id) })) }))

  channel = c.sb
    .channel(`room-${code}`, { config: { presence: { key: c.uid } } })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${code}` }, (p) => setRoom((p.new as Row).data))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rooms', filter: `code=eq.${code}` }, () => void leaveRoom())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_events', filter: `code=eq.${code}` }, (p) => {
      const r = p.new as EventRow
      useRoom.setState((s) => ({ events: [...s.events, { ...r, id: String(r.id) }].slice(-40) }))
    })
    // presence: who has the room open right now
    .on('presence', { event: 'sync' }, () => {
      const state = channel?.presenceState<{ name: string }>() ?? {}
      members = Object.fromEntries(Object.entries(state).map(([id, metas]) => [id, { name: metas[0]?.name ?? 'Гость', seen: Date.now() }]))
      const room = useRoom.getState().room
      if (room) useRoom.setState({ room: { ...room, members } })
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') void channel?.track({ name: myName() })
      if (status === 'CHANNEL_ERROR') useRoom.setState({ error: 'Нет связи с комнатой' })
    })
}

/** rejoins the last room after a restart (once signed in) */
export function resumeRoom() {
  const code = localStorage.getItem(CODE_KEY)
  if (!code || useRoom.getState().code) return
  joinRoom(code).catch(() => localStorage.removeItem(CODE_KEY))
}

function update(patch: Partial<RoomDoc>) {
  const { code, room } = useRoom.getState()
  const c = cloud()
  if (!code || !room || !c) return
  const { members: _, ...rest } = { ...room, ...patch }
  setRoom(rest)
  void c.sb.from('rooms').update({ data: rest, updated_at: new Date().toISOString() }).eq('code', code)
}

let lastPublish = 0
/** playback changed on this device: tell the room */
export function publishPlayback(state: { time: number; playing: boolean }, force = false) {
  const c = cloud()
  if (!useRoom.getState().code || !c) return
  const now = Date.now()
  if (!force && now - lastPublish < 1500) return
  lastPublish = now
  update({ time: state.time, playing: state.playing, at: now, by: c.uid })
}

/** someone opened another episode: everyone follows */
export function publishPath(path: string, title: string) {
  const { code, room } = useRoom.getState()
  const c = cloud()
  if (!code || !c || room?.path === path) return
  update({ path, title, time: 0, playing: false, at: Date.now(), by: c.uid })
}

export function sendEvent(kind: RoomEvent['kind'], text: string) {
  const code = useRoom.getState().code
  const c = cloud()
  if (!code || !c || !text.trim()) return
  void c.sb.from('room_events').insert({ code, kind, text: text.trim().slice(0, 300), name: myName().slice(0, 40), at: Date.now() })
}

export const myUid = () => cloud()?.uid ?? null

/** where the room's video is right now */
export const roomTime = (r: RoomDoc) => r.time + (r.playing ? (Date.now() - r.at) / 1000 : 0)

export const onlineMembers = (r: RoomDoc | null) => (r ? Object.entries(r.members ?? {}).map(([id, m]) => ({ id, ...m })) : [])
