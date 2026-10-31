// Cloud sync through Supabase: accounts, and the user's own rows in user_docs
// (kind progress | title | manga | prefs) plus watch_stats. Row level security keeps every row to its owner.
// Conflicts resolve last-write-wins on updatedAt. Writes that fail without network wait in an outbox
// on the device and go out when it is back.
import { createClient, type SupabaseClient, type User, type RealtimeChannel } from '@supabase/supabase-js'
import { create } from 'zustand'
import { SUPABASE_URL, SUPABASE_KEY } from '../supabase-config'
import { useStore, syncHooks, progressKey, type Progress, type TitleEntry, type SyncedPrefs } from './store'
import { vaultLogin, vaultRemember, vaultForget } from './vault'

export type SyncStatus = 'disabled' | 'signed-out' | 'connecting' | 'synced' | 'offline' | 'error'

export const useSync = create<{ status: SyncStatus; user: User | null; error: string; moving: boolean }>(() => ({
  status: 'disabled',
  user: null,
  error: '',
  moving: false,
}))

export type DocKind = 'progress' | 'title' | 'manga' | 'prefs'
interface Doc {
  key: string
  updatedAt: number
}
interface Kind<T extends Doc> {
  local: () => T[]
  merge: (list: T[]) => void
}

let sb: SupabaseClient | null = null
let uid: string | null = null
let channel: RealtimeChannel | null = null
const kinds: Partial<Record<DocKind, Kind<Doc & Record<string, unknown>>>> = {}

/** the shared client, for profiles, comments and rooms */
export const supabase = () => sb
/** the signed-in account, or null */
export const cloud = () => (sb && uid ? { sb, uid } : null)

let firstSyncResolve: (() => void) | null = null
let firstSync: Promise<void> = Promise.resolve()

/** resolves once fresh server data arrived (or after a timeout), so the player
 *  never resumes from a stale local position and overwrites a newer one */
export function waitForFirstSync(timeout = 3500) {
  return Promise.race([firstSync, new Promise<void>((r) => setTimeout(r, timeout))])
}

/** a store that syncs its entries: the manga shelf registers itself from its own module */
export function registerDocs<T extends { updatedAt: number }>(kind: DocKind, key: (x: T) => string, local: () => T[], merge: (list: T[]) => void) {
  kinds[kind] = {
    local: () => local().map((x) => ({ ...x, key: key(x) }) as unknown as Doc & Record<string, unknown>),
    merge: (list) => merge(list as unknown as T[]),
  }
}

export function initSync() {
  sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'aniplayer-auth' } })
  useSync.setState({ status: 'signed-out' })
  firstSync = new Promise((r) => (firstSyncResolve = r))
  let restored = false

  sb.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null
    if (event === 'TOKEN_REFRESHED' && user?.id === uid) return
    useSync.setState({ user })
    if (user) {
      if (user.id !== uid) void start(user.id)
    } else {
      stop()
      useSync.setState({ status: 'signed-out' })
      // a fresh install: the account kept in the device keychain signs back in
      const saved = vaultLogin()
      if (!restored && saved && event === 'INITIAL_SESSION') {
        restored = true
        void signIn(saved.login, saved.password).catch(() => {})
      }
      firstSyncResolve?.()
    }
  })

  window.addEventListener('online', () => {
    if (!uid) return
    useSync.setState({ status: 'synced' })
    void drainOutbox()
  })
  window.addEventListener('offline', () => uid && useSync.setState({ status: 'offline' }))
}

// a login without "@" is a username: the account behind it gets a private placeholder address
const USERNAME_DOMAIN = '@users.aniplayer.app'
export const USERNAME_RE = /^[a-z0-9._-]{3,24}$/

export function loginToEmail(login: string) {
  const l = login.trim().toLowerCase()
  if (l.includes('@')) return l
  if (!USERNAME_RE.test(l)) throw Object.assign(new Error('bad-username'), { code: 'bad-username' })
  return l + USERNAME_DOMAIN
}

/** what to show for the signed-in account: the username, or the real email */
export function accountName(user: Pick<User, 'email'> | null) {
  const e = user?.email ?? ''
  return e.endsWith(USERNAME_DOMAIN) ? e.slice(0, -USERNAME_DOMAIN.length) : e
}

const fail = (code: string) => Object.assign(new Error(code), { code })

async function createAccount(login: string, email: string, password: string) {
  if (!sb) throw fail('no-cloud')
  if (email.endsWith(USERNAME_DOMAIN)) {
    const { error } = await sb.rpc('register', { login: login.trim().toLowerCase(), password })
    if (error) throw fail(error.message)
  } else {
    const { error } = await sb.auth.signUp({ email, password })
    if (error) throw fail(/already/i.test(error.message) ? 'username-taken' : error.message)
  }
}

export async function signIn(login: string, password: string, register = false) {
  if (!sb) throw fail('no-cloud')
  const email = loginToEmail(login)
  if (register) await createAccount(login, email, password)
  let { error } = await sb.auth.signInWithPassword({ email, password })
  if (error && !register && /invalid login credentials/i.test(error.message)) {
    // not on the new server yet: an account from the old one moves here with everything in it
    useSync.setState({ moving: true })
    try {
      const { readLegacyAccount } = await import('./legacy')
      const old = await readLegacyAccount(email, password)
      if (!old) throw fail('invalid-credential')
      await createAccount(login, email, password).catch((e) => {
        if ((e as { code?: string }).code !== 'username-taken') throw e
      })
      ;({ error } = await sb.auth.signInWithPassword({ email, password }))
      if (error) throw fail('invalid-credential')
      await importLegacy(old)
    } finally {
      useSync.setState({ moving: false })
    }
  }
  if (error) throw fail(/invalid login credentials/i.test(error.message) ? 'invalid-credential' : error.message)
  vaultRemember(login, password)
}

export async function logOut() {
  vaultForget()
  await flushAll()
  if (sb) await sb.auth.signOut()
}

/** deletes the account and everything stored with it */
export async function deleteAccount() {
  if (!sb || !uid) return
  // pictures first: storage files are not removed with the account
  const { data: files } = await sb.storage.from('avatars').list(uid)
  if (files?.length) await sb.storage.from('avatars').remove(files.map((f) => `${uid}/${f.name}`))
  const { error } = await sb.rpc('delete_my_account')
  if (error) throw new Error(error.message)
  vaultForget()
  await sb.auth.signOut()
}

// ---- reading -----------------------------------------------------------------------------------

function stop() {
  if (channel && sb) void sb.removeChannel(channel)
  channel = null
  uid = null
}

type Row = { kind: DocKind; key: string; data: Record<string, unknown>; updated_at: number }

function apply(rows: Row[]) {
  const by: Partial<Record<DocKind, Record<string, unknown>[]>> = {}
  for (const r of rows) (by[r.kind] ??= []).push(r.data)
  const store = useStore.getState()
  if (by.progress) store.mergeRemoteProgress(by.progress as unknown as Progress[])
  if (by.title) store.mergeRemoteTitles(by.title as unknown as TitleEntry[])
  if (by.prefs?.[0]) store.mergeRemotePrefs(by.prefs[0] as unknown as SyncedPrefs)
  if (by.manga) kinds.manga?.merge(by.manga as never)
}

async function start(userId: string) {
  if (!sb) return
  stop()
  uid = userId
  useSync.setState({ status: navigator.onLine ? 'connecting' : 'offline', error: '' })
  try {
    // everything the account has, a thousand rows at a time
    const rows: Row[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('user_docs').select('kind,key,data,updated_at').range(from, from + 999)
      if (error) throw error
      rows.push(...(data as Row[]))
      if (data.length < 1000) break
    }
    if (uid !== userId) return
    apply(rows)
    await uploadNewer(rows)
    const { data: stats } = await sb.from('watch_stats').select('day,seconds')
    useStore.getState().setRemoteStats(Object.fromEntries((stats ?? []).map((s) => [s.day, s.seconds])))
    // the other devices' changes, live
    channel = sb
      .channel(`docs-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_docs', filter: `user_id=eq.${userId}` }, (p) => {
        if (p.new && 'kind' in p.new) apply([p.new as Row])
      })
      .subscribe()
    await drainOutbox()
    flushStats()
    useSync.setState({ status: navigator.onLine ? 'synced' : 'offline' })
  } catch (e) {
    onError(e)
  } finally {
    firstSyncResolve?.()
  }
}

function onError(e: unknown) {
  const message = (e as Error)?.message ?? String(e)
  console.error('[sync]', e)
  useSync.setState({ status: navigator.onLine ? 'error' : 'offline', error: message })
}

const localDocs = (): { kind: DocKind; key: string; data: object; updatedAt: number }[] => {
  const s = useStore.getState()
  const out: { kind: DocKind; key: string; data: object; updatedAt: number }[] = [
    ...Object.values(s.progress).map((p) => ({ kind: 'progress' as const, key: progressKey(p.releaseId, p.ordinal), data: p, updatedAt: p.updatedAt })),
    ...Object.values(s.titles).map((t) => ({ kind: 'title' as const, key: String(t.releaseId), data: t, updatedAt: t.updatedAt })),
  ]
  if (s.prefs.updatedAt) out.push({ kind: 'prefs', key: 'prefs', data: s.prefs, updatedAt: s.prefs.updatedAt })
  for (const d of kinds.manga?.local() ?? []) {
    const { key, ...data } = d
    out.push({ kind: 'manga', key, data, updatedAt: d.updatedAt })
  }
  return out
}

/** first sign-in on a device: send what the cloud lacks or has older */
async function uploadNewer(remote: Row[]) {
  const have = new Map(remote.map((r) => [`${r.kind}:${r.key}`, r.updated_at]))
  const send = localDocs().filter((d) => (have.get(`${d.kind}:${d.key}`) ?? -1) < d.updatedAt)
  await upsert(send)
}

// ---- writing -----------------------------------------------------------------------------------

type Pending = { kind: DocKind; key: string; data: object; updatedAt: number }
const OUTBOX_KEY = 'aniplayer-outbox'
const outbox = new Map<string, Pending>(
  (() => {
    try {
      return (JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as Pending[]).map((p) => [`${p.kind}:${p.key}`, p] as [string, Pending])
    } catch {
      return []
    }
  })(),
)
const saveOutbox = () => {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([...outbox.values()]))
  } catch {
    /* ignore */
  }
}

const inflight = new Set<Promise<unknown>>()

async function upsert(list: Pending[]) {
  if (!sb || !uid || !list.length) return
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500)
    const p = Promise.resolve(
      sb.from('user_docs').upsert(part.map((d) => ({ kind: d.kind, key: d.key, data: JSON.parse(JSON.stringify(d.data)), updated_at: Math.round(d.updatedAt) }))),
    ).then(({ error }) => {
      if (error) throw error
      part.forEach((d) => {
        const k = `${d.kind}:${d.key}`
        if (outbox.get(k)?.updatedAt === d.updatedAt) outbox.delete(k)
      })
      saveOutbox()
    })
    inflight.add(p)
    try {
      await p
    } catch (e) {
      // kept in the outbox: sent again when the network is back
      part.forEach((d) => outbox.set(`${d.kind}:${d.key}`, d))
      saveOutbox()
      onError(e)
      return
    } finally {
      inflight.delete(p)
    }
  }
}

async function drainOutbox() {
  if (outbox.size) await upsert([...outbox.values()])
}

/** a changed entry of any kind goes out (and into the outbox until the server has it) */
export function pushDoc(kind: DocKind, key: string, data: object, updatedAt: number) {
  const d = { kind, key, data, updatedAt }
  outbox.set(`${kind}:${key}`, d)
  saveOutbox()
  if (uid) void upsert([d])
}

const lastPush = new Map<string, number>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const PROGRESS_INTERVAL = 10_000

function writeProgress(p: Progress) {
  const key = progressKey(p.releaseId, p.ordinal)
  lastPush.set(key, Date.now())
  pushDoc('progress', key, p, p.updatedAt)
}

function pushProgress(p: Progress, force = false) {
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

const pushTitle = (t: TitleEntry) => pushDoc('title', String(t.releaseId), t, t.updatedAt)
const pushPrefs = (p: SyncedPrefs) => pushDoc('prefs', 'prefs', p, p.updatedAt ?? Date.now())

let statsTimer: ReturnType<typeof setTimeout> | null = null
function scheduleStats() {
  if (statsTimer || !uid) return
  statsTimer = setTimeout(flushStats, 30_000)
}

function flushStats() {
  if (statsTimer) clearTimeout(statsTimer)
  statsTimer = null
  if (!sb || !uid) return
  const pending = useStore.getState().takePendingStats()
  const data = Object.fromEntries(Object.entries(pending).filter(([, s]) => s > 0).map(([d, s]) => [d, Math.round(s)]))
  if (!Object.keys(data).length) return
  const p = Promise.resolve(sb.rpc('add_watch_time', { p: data })).then(({ error }) => {
    if (error) throw error
  })
  inflight.add(p)
  p.catch(onError).finally(() => inflight.delete(p))
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
  if (!inflight.size || !navigator.onLine) return
  await Promise.race([Promise.allSettled([...inflight]), new Promise((r) => setTimeout(r, timeout))])
}

/** what the old Firebase account held lands in the new one, merged by updatedAt */
async function importLegacy(old: import('./legacy').LegacyData) {
  const store = useStore.getState()
  store.mergeRemoteProgress(old.progress)
  store.mergeRemoteTitles(old.titles)
  if (old.prefs) store.mergeRemotePrefs(old.prefs)
  if (old.manga.length) kinds.manga?.merge(old.manga as never)
  await upsert([
    ...old.progress.map((p) => ({ kind: 'progress' as const, key: progressKey(p.releaseId, p.ordinal), data: p, updatedAt: p.updatedAt })),
    ...old.titles.map((t) => ({ kind: 'title' as const, key: String(t.releaseId), data: t, updatedAt: t.updatedAt })),
    ...old.manga.map((m) => ({ kind: 'manga' as const, key: m.id, data: m, updatedAt: m.updatedAt })),
    ...(old.prefs ? [{ kind: 'prefs' as const, key: 'prefs', data: old.prefs, updatedAt: old.prefs.updatedAt ?? Date.now() }] : []),
  ])
  if (sb && Object.keys(old.stats).length) await sb.rpc('add_watch_time', { p: old.stats })
}

syncHooks.progress = pushProgress
syncHooks.title = pushTitle
syncHooks.prefs = pushPrefs
syncHooks.stats = scheduleStats
