import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { posterUrl, type Release } from './api'

export interface Progress {
  releaseId: number
  ordinal: number
  time: number
  duration: number
  watched: boolean
  updatedAt: number
  preview?: string
}

export type ListStatus = 'watching' | 'planned' | 'completed' | 'postponed' | 'dropped'
export const LIST_LABELS: Record<ListStatus, string> = {
  watching: 'Смотрю',
  planned: 'В планах',
  completed: 'Просмотрено',
  postponed: 'Отложено',
  dropped: 'Брошено',
}
export const LIST_COLORS: Record<ListStatus, string> = {
  watching: '#a78bfa',
  planned: '#2dd4bf',
  completed: '#84cc16',
  postponed: '#facc15',
  dropped: '#f43f5e',
}

export interface TitleEntry {
  releaseId: number
  alias: string
  name: string
  poster: string
  year?: number
  type?: string
  episodesTotal: number | null
  malId?: number | null
  lastOrdinal?: number
  lastWatchedAt?: number
  lastPreview?: string
  status?: ListStatus | null
  favorite?: boolean
  updatedAt: number
}

// prefs that follow you between devices
export interface SyncedPrefs {
  quality: '480' | '720' | '1080'
  autoSkipOpening: boolean
  autoSkipEnding: boolean
  autoNext: boolean
  anilistToken: string
  anilistSync: boolean
  updatedAt: number
}

// prefs that stay on this device
export interface LocalPrefs {
  volume: number
  muted: boolean
  rate: number
}

export const progressKey = (releaseId: number, ordinal: number) => `${releaseId}_${String(ordinal).replace('.', '-')}`
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** an episode counts as watched past 88% or once the ending begins */
export const WATCHED_RATIO = 0.88

interface State {
  progress: Record<string, Progress>
  titles: Record<string, TitleEntry>
  statsDays: Record<string, number> // seconds watched per day (all devices)
  pendingStats: Record<string, number> // seconds not yet sent to the cloud
  prefs: SyncedPrefs
  local: LocalPrefs

  saveProgress: (p: Omit<Progress, 'updatedAt'>, force?: boolean) => Progress
  setWatched: (releaseId: number, ordinal: number, watched: boolean, duration?: number) => void
  touchTitle: (r: Release, patch?: Partial<TitleEntry>) => TitleEntry
  setStatus: (r: Release, status: ListStatus | null) => void
  toggleFavorite: (r: Release) => void
  removeFromHistory: (releaseId: number) => void
  addWatchTime: (seconds: number) => void
  setPrefs: (patch: Partial<SyncedPrefs>) => void
  setLocal: (patch: Partial<LocalPrefs>) => void

  // used by the sync layer: apply remote data without echoing it back
  mergeRemoteProgress: (items: Progress[]) => void
  mergeRemoteTitles: (items: TitleEntry[]) => void
  setRemoteStats: (days: Record<string, number>) => void
  takePendingStats: () => Record<string, number>
  mergeRemotePrefs: (p: Partial<SyncedPrefs>) => void
}

// set by sync.ts so the store can push without importing firebase
export const syncHooks: {
  progress?: (p: Progress, force?: boolean) => void
  title?: (t: TitleEntry) => void
  prefs?: (p: SyncedPrefs) => void
  stats?: () => void
} = {}

function entryFromRelease(r: Release, prev?: TitleEntry): TitleEntry {
  return {
    ...prev,
    releaseId: r.id,
    alias: r.alias,
    name: r.name.main,
    poster: posterUrl(r),
    year: r.year,
    type: r.type?.description,
    episodesTotal: r.episodes_total ?? prev?.episodesTotal ?? null,
    malId: r.mal?.id ?? prev?.malId ?? null,
    updatedAt: Date.now(),
  }
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      progress: {},
      titles: {},
      statsDays: {},
      pendingStats: {},
      prefs: {
        quality: '1080',
        autoSkipOpening: true,
        autoSkipEnding: true,
        autoNext: true,
        anilistToken: '',
        anilistSync: true,
        updatedAt: 0,
      },
      local: { volume: 1, muted: false, rate: 1 },

      saveProgress: (p, force) => {
        const key = progressKey(p.releaseId, p.ordinal)
        const prev = get().progress[key]
        const watched = prev?.watched || (p.duration > 0 && p.time / p.duration >= WATCHED_RATIO) || p.watched
        const next: Progress = { ...p, watched, updatedAt: Date.now() }
        set((s) => ({ progress: { ...s.progress, [key]: next } }))
        syncHooks.progress?.(next, force)
        return next
      },

      setWatched: (releaseId, ordinal, watched, duration) => {
        const key = progressKey(releaseId, ordinal)
        const prev = get().progress[key]
        const next: Progress = {
          ...prev,
          releaseId,
          ordinal,
          duration: prev?.duration || duration || 0,
          time: watched ? prev?.time ?? 0 : 0,
          watched,
          updatedAt: Date.now(),
        }
        set((s) => ({ progress: { ...s.progress, [key]: next } }))
        syncHooks.progress?.(next, true)
      },

      touchTitle: (r, patch) => {
        const entry = { ...entryFromRelease(r, get().titles[r.id]), ...patch, updatedAt: Date.now() }
        set((s) => ({ titles: { ...s.titles, [r.id]: entry } }))
        syncHooks.title?.(entry)
        return entry
      },

      setStatus: (r, status) => {
        get().touchTitle(r, { status })
      },

      toggleFavorite: (r) => {
        get().touchTitle(r, { favorite: !get().titles[r.id]?.favorite })
      },

      removeFromHistory: (releaseId) => {
        const t = get().titles[releaseId]
        if (!t) return
        const entry = { ...t, lastWatchedAt: 0, updatedAt: Date.now() }
        set((s) => ({ titles: { ...s.titles, [releaseId]: entry } }))
        syncHooks.title?.(entry)
      },

      addWatchTime: (seconds) => {
        if (seconds <= 0) return
        const d = dayKey()
        set((s) => ({
          statsDays: { ...s.statsDays, [d]: (s.statsDays[d] ?? 0) + seconds },
          pendingStats: { ...s.pendingStats, [d]: (s.pendingStats[d] ?? 0) + seconds },
        }))
        syncHooks.stats?.()
      },

      setPrefs: (patch) => {
        const prefs = { ...get().prefs, ...patch, updatedAt: Date.now() }
        set({ prefs })
        syncHooks.prefs?.(prefs)
      },

      setLocal: (patch) => set((s) => ({ local: { ...s.local, ...patch } })),

      mergeRemoteProgress: (items) => {
        const cur = get().progress
        let changed: Record<string, Progress> | null = null
        for (const p of items) {
          const key = progressKey(p.releaseId, p.ordinal)
          const mine = cur[key]
          if (!mine || p.updatedAt > mine.updatedAt) (changed ??= { ...cur })[key] = p
        }
        if (changed) set({ progress: changed })
      },

      mergeRemoteTitles: (items) => {
        const cur = get().titles
        let changed: Record<string, TitleEntry> | null = null
        for (const t of items) {
          const mine = cur[t.releaseId]
          if (!mine || t.updatedAt > mine.updatedAt) (changed ??= { ...cur })[t.releaseId] = t
        }
        if (changed) set({ titles: changed })
      },

      setRemoteStats: (days) => {
        // remote totals plus whatever this device has not flushed yet
        const pending = get().pendingStats
        const merged = { ...days }
        for (const [d, s] of Object.entries(pending)) merged[d] = (merged[d] ?? 0) + s
        set({ statsDays: merged })
      },

      takePendingStats: () => {
        const pending = get().pendingStats
        set({ pendingStats: {} })
        return pending
      },

      mergeRemotePrefs: (p) => {
        if ((p.updatedAt ?? 0) > get().prefs.updatedAt) set((s) => ({ prefs: { ...s.prefs, ...p } }))
      },
    }),
    {
      name: 'aniplayer-store',
      version: 2,
      // v2: auto-skip with a 5 second "watch it" window became the default
      migrate: (old, version) => {
        const st = old as State
        if (version < 2 && st?.prefs) st.prefs = { ...st.prefs, autoSkipOpening: true, autoSkipEnding: true }
        return st
      },
    },
  ),
)

export const getProgress = (releaseId: number, ordinal: number) =>
  useStore.getState().progress[progressKey(releaseId, ordinal)]

export function releaseProgress(progress: Record<string, Progress>, releaseId: number) {
  return Object.values(progress).filter((p) => p.releaseId === releaseId)
}
