// What is playing, shown as the Discord status in the desktop app («Смотрит Anyflow · Магическая битва ·
// Серия 8 из 24», with a progress bar), and anyflow://join/CODE invites: the «Смотреть вместе» button
// on that status, or a link from a friend, opens their watch-together room at the same second.
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useStore } from './store'
import { useRoom, createRoom, joinRoom } from './room'
import { useSync } from './sync'
import { needAccount } from './guest'

export interface NowPlaying {
  title: string
  /** «Серия 8 из 24» */
  episode: string
  poster: string
  path: string
  time: number
  duration: number
  playing: boolean
}

export const useNowPlaying = create<{ now: NowPlaying | null }>(() => ({ now: null }))
export const setNowPlaying = (now: NowPlaying | null) => useNowPlaying.setState({ now })

export const JOIN_PAGE = 'https://vanaedynak.github.io/AniPlayer/join.html'
export const inviteLink = (code: string) => `${JOIN_PAGE}?r=${code}`
export const appInviteLink = (code: string) => `${__FLAVOR__.scheme}://join/${code}`

export const discordAvailable = () => !!window.aniplayer?.discord

/** a room code from anyflow://join/CODE or the join page's ?r=CODE */
export function codeFromLink(url: string): string | null {
  const m = /join\/([A-Za-z0-9]{6})/.exec(url) ?? /[?&]r=([A-Za-z0-9]{6})/.exec(url)
  return m ? m[1].toUpperCase() : null
}

/** lives in Layout: opens invites and keeps the Discord status up to date */
export function DiscordBridge() {
  const user = useSync((s) => s.user)
  const ready = useSync((s) => s.ready)
  const pending = useRef<string | null>(null)

  // invites: join once signed in (the room needs an account)
  useEffect(() => {
    const join = (code: string) => {
      if (!useSync.getState().user) {
        pending.current = code
        needAccount('Смотреть вместе с друзьями')
        return
      }
      void joinRoom(code).catch((e: Error) => useRoom.setState({ error: e.message }))
    }
    return window.aniplayer?.onDeepLink?.((url) => {
      const code = codeFromLink(url)
      if (code) join(code)
    })
  }, [])
  useEffect(() => {
    if (user && ready && pending.current) {
      const code = pending.current
      pending.current = null
      void joinRoom(code).catch(() => {})
    }
  }, [user, ready])

  const on = useStore((s) => !!s.local.discord)
  const appId = useStore((s) => s.local.discordAppId?.trim() ?? '')
  const invite = useStore((s) => !!s.local.discordInvite)
  const now = useNowPlaying((s) => s.now)
  const code = useRoom((s) => s.code)
  const roomFor = useRef<string | null>(null)

  // «Смотреть вместе» on the status: a room is opened for the episode being watched
  useEffect(() => {
    if (!on || !invite || !user || !now?.playing || code || roomFor.current === now.path) return
    roomFor.current = now.path
    void createRoom(now.path, `${now.title} · ${now.episode}`, now.time, true).catch(() => {})
  }, [on, invite, user, now?.playing, now?.path, code, now])

  // Discord takes a few updates a minute: only what is shown changes it, not every second of playback
  const key = now ? `${now.title}|${now.episode}|${now.playing}|${Math.round((now.playing ? Date.now() / 1000 - now.time : now.time) / 5)}|${code}` : ''
  useEffect(() => {
    const d = window.aniplayer?.discord
    if (!d) return
    if (!on || !appId || !now) {
      void d.setActivity(appId, null).catch(() => {})
      return
    }
    const t = setTimeout(() => {
      const start = Date.now() - now.time * 1000
      const activity: Record<string, unknown> = {
        type: 3, // «Смотрит»
        details: now.title.slice(0, 120),
        state: (now.playing ? now.episode : `${now.episode} · пауза`).slice(0, 120),
        assets: {
          large_image: now.poster.startsWith('https://') ? now.poster : 'logo',
          large_text: now.title.slice(0, 120),
          small_image: 'logo',
          small_text: 'Anyflow',
        },
        instance: false,
      }
      if (now.playing && now.duration > 0) activity.timestamps = { start, end: start + now.duration * 1000 }
      const buttons = []
      if (code) buttons.push({ label: 'Смотреть вместе', url: inviteLink(code) })
      buttons.push({ label: 'Скачать Anyflow', url: `https://github.com/${__FLAVOR__.repo}/releases/latest` })
      activity.buttons = buttons
      void d.setActivity(appId, activity).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, appId, key])

  return null
}
