// Watch together: a Firestore document per room keeps the episode, position and play state;
// a subcollection carries reactions and chat. Everyone in the room may drive playback.
// Layout: rooms/{code} { path, title, time, playing, at, by, members: {uid: {name, seen}} }
//         rooms/{code}/events/{id} { kind: 'emoji' | 'chat', text, name, uid, at }
import { create } from 'zustand'
import { doc, collection, onSnapshot, setDoc, updateDoc, addDoc, query, orderBy, limit, deleteField, getDoc, type Unsubscribe } from 'firebase/firestore'
import { firestore, useSync, accountName } from './sync'

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
let unsubs: Unsubscribe[] = []
let heartbeat: ReturnType<typeof setInterval> | undefined

const myName = () => accountName(useSync.getState().user) || 'Гость'

function need() {
  const f = firestore()
  if (!f) throw new Error('Войдите в аккаунт (Настройки → Синхронизация), чтобы смотреть вместе')
  return f
}

export async function createRoom(path: string, title: string, time: number, playing: boolean) {
  const { db, uid } = need()
  const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join('')
  const room: RoomDoc = { path, title, time, playing, at: Date.now(), by: uid, members: { [uid]: { name: myName(), seen: Date.now() } }, createdAt: Date.now() }
  await setDoc(doc(db, 'rooms', code), room)
  listen(code)
  return code
}

export async function joinRoom(raw: string) {
  const { db, uid } = need()
  const code = raw.trim().toUpperCase()
  const snap = await getDoc(doc(db, 'rooms', code))
  if (!snap.exists()) throw new Error('Комната не найдена — проверьте код')
  await updateDoc(doc(db, 'rooms', code), { [`members.${uid}`]: { name: myName(), seen: Date.now() } })
  listen(code)
  return snap.data() as RoomDoc
}

export async function leaveRoom() {
  const code = useRoom.getState().code
  const f = firestore()
  stop()
  useRoom.setState({ code: null, room: null, events: [], error: '' })
  localStorage.removeItem(CODE_KEY)
  if (code && f) await updateDoc(doc(f.db, 'rooms', code), { [`members.${f.uid}`]: deleteField() }).catch(() => {})
}

function stop() {
  unsubs.forEach((u) => u())
  unsubs = []
  clearInterval(heartbeat)
}

function listen(code: string) {
  const f = firestore()
  if (!f) return
  stop()
  localStorage.setItem(CODE_KEY, code)
  useRoom.setState({ code, error: '', events: [] })
  unsubs.push(
    onSnapshot(
      doc(f.db, 'rooms', code),
      (s) => {
        if (!s.exists()) return void leaveRoom()
        useRoom.setState({ room: s.data() as RoomDoc })
      },
      (e) => useRoom.setState({ error: e.message.includes('permission') ? 'Нет доступа к комнатам: обновите правила Firestore (SETUP.md)' : e.message }),
    ),
    onSnapshot(query(collection(f.db, 'rooms', code, 'events'), orderBy('at', 'desc'), limit(40)), (s) =>
      useRoom.setState({ events: s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RoomEvent, 'id'>) })).reverse() }),
    ),
  )
  // presence: members that stopped pinging fade out of the list
  heartbeat = setInterval(() => {
    const ff = firestore()
    if (ff) updateDoc(doc(ff.db, 'rooms', code), { [`members.${ff.uid}.seen`]: Date.now() }).catch(() => {})
  }, 30_000)
}

/** rejoins the last room after a restart (once signed in) */
export function resumeRoom() {
  const code = localStorage.getItem(CODE_KEY)
  if (!code || useRoom.getState().code) return
  joinRoom(code).catch(() => localStorage.removeItem(CODE_KEY))
}

let lastPublish = 0
/** playback changed on this device: tell the room */
export function publishPlayback(state: { time: number; playing: boolean }, force = false) {
  const code = useRoom.getState().code
  const f = firestore()
  if (!code || !f) return
  const now = Date.now()
  if (!force && now - lastPublish < 1500) return
  lastPublish = now
  updateDoc(doc(f.db, 'rooms', code), { time: state.time, playing: state.playing, at: now, by: f.uid }).catch(() => {})
}

/** someone opened another episode: everyone follows */
export function publishPath(path: string, title: string) {
  const { code, room } = useRoom.getState()
  const f = firestore()
  if (!code || !f || room?.path === path) return
  updateDoc(doc(f.db, 'rooms', code), { path, title, time: 0, playing: false, at: Date.now(), by: f.uid }).catch(() => {})
}

export function sendEvent(kind: RoomEvent['kind'], text: string) {
  const code = useRoom.getState().code
  const f = firestore()
  if (!code || !f || !text.trim()) return
  addDoc(collection(f.db, 'rooms', code, 'events'), { kind, text: text.trim().slice(0, 300), name: myName(), uid: f.uid, at: Date.now() }).catch(() => {})
}

export const myUid = () => firestore()?.uid ?? null

/** where the room's video is right now */
export const roomTime = (r: RoomDoc) => r.time + (r.playing ? (Date.now() - r.at) / 1000 : 0)

export const onlineMembers = (r: RoomDoc | null) =>
  r ? Object.entries(r.members ?? {}).filter(([, m]) => Date.now() - m.seen < 75_000).map(([id, m]) => ({ id, ...m })) : []
