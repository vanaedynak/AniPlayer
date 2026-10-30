// Offline episodes: the HLS playlist and every segment are saved to device storage,
// then played back through hls.js with a loader that reads `offline://` URLs from that storage.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import Hls from 'hls.js'
import type { Episode, Release } from './api'
import { storage, keepStorage } from './offline'

export type DlQuality = '480' | '720' | '1080'
export type DlStatus = 'queued' | 'downloading' | 'done' | 'error' | 'paused'

export interface DlItem {
  key: string
  releaseId: number
  alias: string
  ordinal: number
  quality: DlQuality
  status: DlStatus
  done: number
  total: number
  bytes: number
  error?: string
  addedAt: number
}

interface DlState {
  items: Record<string, DlItem>
  /** trimmed release JSON so the title and its episodes open without network */
  releases: Record<string, Release>
  quality: DlQuality
  add: (r: Release, eps: Episode[], q?: DlQuality) => void
  remove: (key: string) => Promise<void>
  removeRelease: (releaseId: number) => Promise<void>
  pause: (key: string) => void
  resume: (key: string) => void
  setQuality: (q: DlQuality) => void
  patch: (key: string, p: Partial<DlItem>) => void
}

export const dlKey = (releaseId: number, ordinal: number) => `${releaseId}_${String(ordinal).replace('.', '-')}`
export const OFFLINE = 'offline://'
export const offlineUrl = (key: string) => `${OFFLINE}${key}/index.m3u8`

export const useDownloads = create<DlState>()(
  persist(
    (set, get) => ({
      items: {},
      releases: {},
      quality: '720',
      add: (r, eps, q) => {
        const quality = q ?? get().quality
        const items = { ...get().items }
        for (const e of eps) {
          const key = dlKey(r.id, e.ordinal)
          if (items[key] && items[key].status !== 'error') continue
          items[key] = { key, releaseId: r.id, alias: r.alias, ordinal: e.ordinal, quality, status: 'queued', done: 0, total: 0, bytes: 0, addedAt: Date.now() }
        }
        const { members: _m, torrents: _t, ...slim } = r
        set({ items, releases: { ...get().releases, [r.alias]: slim as Release } })
        void keepStorage()
        pump()
      },
      remove: async (key) => {
        const { [key]: _, ...items } = get().items
        set({ items })
        active.get(key)?.abort()
        await storage.removeDir(key)
        cleanupReleases()
      },
      removeRelease: async (releaseId) => {
        const keys = Object.values(get().items).filter((i) => i.releaseId === releaseId).map((i) => i.key)
        for (const k of keys) await get().remove(k)
      },
      pause: (key) => {
        active.get(key)?.abort()
        get().patch(key, { status: 'paused' })
      },
      resume: (key) => {
        get().patch(key, { status: 'queued', error: undefined })
        pump()
      },
      setQuality: (quality) => set({ quality }),
      patch: (key, p) => {
        const it = get().items[key]
        if (it) set({ items: { ...get().items, [key]: { ...it, ...p } } })
      },
    }),
    {
      name: 'aniplayer-downloads',
      // a download cut off by closing the app continues on the next start
      onRehydrateStorage: () => (s) => {
        if (!s) return
        for (const it of Object.values(s.items)) if (it.status === 'downloading') it.status = 'queued'
        setTimeout(pump, 1500)
      },
    },
  ),
)

function cleanupReleases() {
  const s = useDownloads.getState()
  const used = new Set(Object.values(s.items).map((i) => i.alias))
  const releases = Object.fromEntries(Object.entries(s.releases).filter(([a]) => used.has(a)))
  useDownloads.setState({ releases })
}

// ---- the queue: one episode at a time, a few segments in parallel ----
const active = new Map<string, AbortController>()
const PARALLEL = 4

function pump() {
  if (active.size) return
  const next = Object.values(useDownloads.getState().items)
    .filter((i) => i.status === 'queued')
    .sort((a, b) => a.addedAt - b.addedAt || a.ordinal - b.ordinal)[0]
  if (next) void run(next)
}

async function run(item: DlItem) {
  const s = useDownloads.getState
  const ctl = new AbortController()
  active.set(item.key, ctl)
  s().patch(item.key, { status: 'downloading', error: undefined })
  try {
    const r = s().releases[item.alias]
    const ep = r?.episodes?.find((e) => e.ordinal === item.ordinal)
    const src = ep && (ep[`hls_${item.quality}`] ?? ep.hls_720 ?? ep.hls_480 ?? ep.hls_1080)
    if (!src) throw new Error('У серии нет видео')
    const text = await (await fetch(src, { signal: ctl.signal })).text()
    const lines = text.split('\n')
    const segs: string[] = []
    // segment URLs become seg0.ts, seg1.ts… next to a rewritten playlist
    const local = lines.map((l) => {
      const t = l.trim()
      if (!t || t.startsWith('#')) return l
      segs.push(new URL(t, src).href)
      return `seg${segs.length - 1}.ts`
    })
    // an interrupted episode starts over: parallel workers leave no reliable "written up to here" mark
    s().patch(item.key, { total: segs.length, done: 0, bytes: 0 })
    let done = 0
    let bytes = 0
    let cursor = 0
    const worker = async () => {
      while (cursor < segs.length) {
        const i = cursor++
        let tries = 0
        for (;;) {
          try {
            const res = await fetch(segs[i], { signal: ctl.signal })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const buf = new Uint8Array(await res.arrayBuffer())
            await storage.write(`${item.key}/seg${i}.ts`, buf)
            bytes += buf.byteLength
            break
          } catch (e) {
            if (ctl.signal.aborted || ++tries >= 4) throw e
            await new Promise((r) => setTimeout(r, 1500 * tries))
          }
        }
        done++
        if (!s().items[item.key]) throw new DOMException('removed', 'AbortError')
        s().patch(item.key, { done, bytes })
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))
    await storage.write(`${item.key}/index.m3u8`, local.join('\n'))
    s().patch(item.key, { status: 'done', done: segs.length })
  } catch (e) {
    if (!ctl.signal.aborted) s().patch(item.key, { status: 'error', error: navigator.onLine ? String((e as Error).message ?? e) : 'Нет сети' })
  } finally {
    active.delete(item.key)
    pump()
  }
}

window.addEventListener('online', () => {
  const s = useDownloads.getState()
  for (const it of Object.values(s.items)) if (it.status === 'error' && it.error === 'Нет сети') s.patch(it.key, { status: 'queued', error: undefined })
  pump()
})

export const downloaded = (releaseId: number, ordinal: number) => {
  const it = useDownloads.getState().items[dlKey(releaseId, ordinal)]
  return it?.status === 'done' ? it : null
}

// ---- playback: hls.js asks for offline:// URLs, we answer from storage ----
const Base = Hls.DefaultConfig.loader

export class OfflineLoader extends Base {
  load(...args: Parameters<InstanceType<typeof Base>['load']>) {
    const [context, , callbacks] = args
    if (!context.url.startsWith(OFFLINE)) return super.load(...args)
    const stats = this.stats
    stats.loading.start = performance.now()
    const path = context.url.slice(OFFLINE.length).split('?')[0]
    storage
      .read(path)
      .then((bytes) => {
        stats.loading.first = stats.loading.end = performance.now()
        stats.loaded = stats.total = bytes.byteLength
        const data = context.responseType === 'arraybuffer' ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : new TextDecoder().decode(bytes)
        callbacks.onSuccess({ url: context.url, data: data as ArrayBuffer }, stats, context, null)
      })
      .catch((e) => callbacks.onError({ code: 404, text: String(e) }, context, null, stats))
  }
}

/** the release from the network, or the copy saved with its downloads when offline */
export async function releaseOrOffline(alias: string, load: () => Promise<Release>) {
  try {
    return await load()
  } catch (e) {
    const saved = useDownloads.getState().releases[alias]
    if (saved) return saved
    throw e
  }
}

export const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} ГБ` : `${Math.round(b / 1e6)} МБ`)
