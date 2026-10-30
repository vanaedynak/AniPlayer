// Cloud sync through Firebase (Auth + Firestore, free Spark plan).
// Layout: users/{uid}/progress/{releaseId_ordinal}, users/{uid}/titles/{releaseId},
//         users/{uid}/meta/stats  { "2026-10-29": seconds, ... }, users/{uid}/meta/prefs
// Conflicts resolve last-write-wins on updatedAt; Firestore's offline cache queues
// writes made without network (or right before the app is closed) and sends them later.
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  doc,
  collection,
  onSnapshot,
  setDoc,
  increment,
  waitForPendingWrites,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore'
import { create } from 'zustand'
import { firebaseConfig as bakedConfig } from '../firebase-config'
import { useStore, syncHooks, progressKey, type Progress, type TitleEntry, type SyncedPrefs } from './store'

export type SyncStatus = 'disabled' | 'signed-out' | 'connecting' | 'synced' | 'offline' | 'error'

export const useSync = create<{ status: SyncStatus; user: User | null; error: string }>(() => ({
  status: 'disabled',
  user: null,
  error: '',
}))

const CONFIG_KEY = 'aniplayer-firebase-config'

export function getFirebaseConfig(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore broken override */
  }
  return bakedConfig && bakedConfig.apiKey ? bakedConfig : null
}

/** accepts either pure JSON or the `const firebaseConfig = {...}` snippet from the console */
export function saveFirebaseConfig(text: string) {
  const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  const json = body.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}')
  const cfg = JSON.parse(json)
  if (!cfg.apiKey || !cfg.projectId) throw new Error('В конфиге нет apiKey/projectId')
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
  location.reload()
}

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let unsubs: Unsubscribe[] = []
let uid: string | null = null

let firstSyncResolve: (() => void) | null = null
let firstSync: Promise<void> = Promise.resolve()

/** resolves once fresh server data arrived (or after a timeout), so the player
 *  never resumes from a stale local position and overwrites a newer one */
export function waitForFirstSync(timeout = 3500) {
  return Promise.race([firstSync, new Promise<void>((r) => setTimeout(r, timeout))])
}

export function initSync() {
  const cfg = getFirebaseConfig()
  if (!cfg) return
  try {
    app = initializeApp(cfg)
    auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({ forceOwnership: true }) }),
    })
  } catch (e) {
    useSync.setState({ status: 'error', error: String(e) })
    return
  }
  useSync.setState({ status: 'signed-out' })
  firstSync = new Promise((r) => (firstSyncResolve = r))

  onAuthStateChanged(auth, (user) => {
    stopListeners()
    useSync.setState({ user })
    if (user) startListeners(user.uid)
    else {
      uid = null
      useSync.setState({ status: 'signed-out' })
      firstSyncResolve?.()
    }
  })

  window.addEventListener('online', () => uid && useSync.setState({ status: 'synced' }))
  window.addEventListener('offline', () => uid && useSync.setState({ status: 'offline' }))
}

// a login without "@" is a username: Firebase only knows emails, so it gets a private placeholder address
const USERNAME_DOMAIN = '@users.aniplayer.app'
export const USERNAME_RE = /^[a-z0-9._-]{3,24}$/

export function loginToEmail(login: string) {
  const l = login.trim().toLowerCase()
  if (l.includes('@')) return l
  if (!USERNAME_RE.test(l)) throw Object.assign(new Error(), { code: 'bad-username' })
  return l + USERNAME_DOMAIN
}

/** what to show for the signed-in account: the username, or the real email */
export function accountName(user: User | null) {
  const e = user?.email ?? ''
  return e.endsWith(USERNAME_DOMAIN) ? e.slice(0, -USERNAME_DOMAIN.length) : e
}

export async function signIn(login: string, password: string, register = false) {
  if (!auth) throw new Error('Firebase не настроен')
  const email = loginToEmail(login)
  if (register) await createUserWithEmailAndPassword(auth, email, password)
  else await signInWithEmailAndPassword(auth, email, password)
}

export async function logOut() {
  if (auth) await signOut(auth)
}

function stopListeners() {
  unsubs.forEach((u) => u())
  unsubs = []
}

function startListeners(userId: string) {
  if (!db) return
  uid = userId
  useSync.setState({ status: navigator.onLine ? 'connecting' : 'offline' })
  const store = useStore.getState
  let progressReady = false
  let titlesReady = false

  const maybeReady = () => {
    if (progressReady && titlesReady) {
      useSync.setState({ status: navigator.onLine ? 'synced' : 'offline' })
      firstSyncResolve?.()
    }
  }

  unsubs.push(
    onSnapshot(
      collection(db, 'users', userId, 'progress'),
      { includeMetadataChanges: true },
      (snap) => {
        const remote: Progress[] = []
        snap.docChanges().forEach((c) => c.type !== 'removed' && remote.push(c.doc.data() as Progress))
        if (remote.length) store().mergeRemoteProgress(remote)
        if (!snap.metadata.fromCache && !progressReady) {
          progressReady = true
          uploadMissing(
            'progress',
            snap.docs.map((d) => d.data() as Progress),
            Object.values(store().progress),
            (p) => progressKey(p.releaseId, p.ordinal),
          )
          maybeReady()
        }
      },
      onError,
    ),
    onSnapshot(
      collection(db, 'users', userId, 'titles'),
      { includeMetadataChanges: true },
      (snap) => {
        const remote: TitleEntry[] = []
        snap.docChanges().forEach((c) => c.type !== 'removed' && remote.push(c.doc.data() as TitleEntry))
        if (remote.length) store().mergeRemoteTitles(remote)
        if (!snap.metadata.fromCache && !titlesReady) {
          titlesReady = true
          uploadMissing(
            'titles',
            snap.docs.map((d) => d.data() as TitleEntry),
            Object.values(store().titles),
            (t) => String(t.releaseId),
          )
          maybeReady()
        }
      },
      onError,
    ),
    onSnapshot(
      doc(db, 'users', userId, 'meta', 'stats'),
      (snap) => store().setRemoteStats((snap.data() as Record<string, number>) ?? {}),
      onError,
    ),
    onSnapshot(
      doc(db, 'users', userId, 'meta', 'prefs'),
      (snap) => {
        const p = snap.data() as SyncedPrefs | undefined
        if (p) store().mergeRemotePrefs(p)
        else if (store().prefs.updatedAt) pushPrefs(store().prefs)
      },
      onError,
    ),
  )
  // stats this device gathered before signing in
  flushStats()
}

function onError(e: Error) {
  console.error('[sync]', e)
  useSync.setState({ status: 'error', error: e.message })
  firstSyncResolve?.()
}

/** first login on a device: send local entries the cloud lacks or has older */
function uploadMissing<T extends { updatedAt: number }>(
  col: 'progress' | 'titles',
  remote: T[],
  local: T[],
  key: (x: T) => string,
) {
  if (!db || !uid) return
  const remoteMap = new Map(remote.map((r) => [key(r), r]))
  const toSend = local.filter((l) => {
    const r = remoteMap.get(key(l))
    return !r || l.updatedAt > r.updatedAt
  })
  for (let i = 0; i < toSend.length; i += 400) {
    const batch = writeBatch(db)
    toSend.slice(i, i + 400).forEach((x) => batch.set(doc(db!, 'users', uid!, col, key(x)), x))
    batch.commit().catch(onError)
  }
}

// ---- pushing local changes ----

const lastPush = new Map<string, number>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const PROGRESS_INTERVAL = 10_000

function writeProgress(p: Progress) {
  if (!db || !uid) return
  const key = progressKey(p.releaseId, p.ordinal)
  lastPush.set(key, Date.now())
  setDoc(doc(db, 'users', uid, 'progress', key), p).catch(onError)
}

function pushProgress(p: Progress, force = false) {
  if (!db || !uid) return
  const key = progressKey(p.releaseId, p.ordinal)
  clearTimeout(timers.get(key))
  const since = Date.now() - (lastPush.get(key) ?? 0)
  if (force || since >= PROGRESS_INTERVAL) return writeProgress(p)
  // trailing write so the last position always lands
  timers.set(
    key,
    setTimeout(() => writeProgress(useStore.getState().progress[key] ?? p), PROGRESS_INTERVAL - since),
  )
}

function pushTitle(t: TitleEntry) {
  if (!db || !uid) return
  setDoc(doc(db, 'users', uid, 'titles', String(t.releaseId)), t).catch(onError)
}

function pushPrefs(p: SyncedPrefs) {
  if (!db || !uid) return
  setDoc(doc(db, 'users', uid, 'meta', 'prefs'), p).catch(onError)
}

let statsTimer: ReturnType<typeof setTimeout> | null = null
function scheduleStats() {
  if (statsTimer || !uid) return
  statsTimer = setTimeout(flushStats, 30_000)
}

function flushStats() {
  if (statsTimer) clearTimeout(statsTimer)
  statsTimer = null
  if (!db || !uid) return
  const pending = useStore.getState().takePendingStats()
  const data: Record<string, ReturnType<typeof increment>> = {}
  for (const [d, s] of Object.entries(pending)) if (s > 0) data[d] = increment(Math.round(s))
  if (Object.keys(data).length) setDoc(doc(db, 'users', uid, 'meta', 'stats'), data, { merge: true }).catch(onError)
}

/** send everything right now: called on pause, tab hide and app close */
export async function flushAll(timeout = 2500) {
  for (const [key, t] of timers) {
    clearTimeout(t)
    timers.delete(key)
    const p = useStore.getState().progress[key]
    if (p) writeProgress(p)
  }
  flushStats()
  if (!db || !uid || !navigator.onLine) return
  await Promise.race([waitForPendingWrites(db).catch(() => {}), new Promise((r) => setTimeout(r, timeout))])
}

syncHooks.progress = pushProgress
syncHooks.title = pushTitle
syncHooks.prefs = pushPrefs
syncHooks.stats = scheduleStats

/** shared handles for features that live outside users/{uid} (watch-together rooms) */
export const firestore = () => (db && uid ? { db, uid } : null)
