// Openings and endings from AnimeThemes (api.animethemes.moe): open API, full-quality clips and audio by MAL id.
import { create } from 'zustand'

export interface Theme {
  id: string
  kind: 'OP' | 'ED'
  slug: string // OP1, ED2…
  song: string
  artists: string
  episodes: string
  video: string
  audio: string | null
  anime: string
  cover: string
  malId: number
}

const API = 'https://api.animethemes.moe'
const cache = new Map<number, Promise<Theme[]>>()

interface ATAnime {
  name: string
  images?: { facet: string; link: string }[]
  animethemes: {
    id: number
    type: 'OP' | 'ED'
    slug: string
    song?: { title?: string; artists?: { name: string }[] }
    animethemeentries: { episodes?: string; nsfw?: boolean; spoiler?: boolean; videos?: { link: string; resolution?: number; audio?: { link: string } }[] }[]
  }[]
}

export function themesFor(malId: number): Promise<Theme[]> {
  let p = cache.get(malId)
  if (!p) {
    const q = new URLSearchParams({
      'filter[has]': 'resources',
      'filter[site]': 'MyAnimeList',
      'filter[external_id]': String(malId),
      include: 'animethemes.animethemeentries.videos.audio,animethemes.song.artists,images',
    })
    p = fetch(`${API}/anime?${q}`)
      .then((r) => (r.ok ? r.json() : { anime: [] }))
      .then((d: { anime: ATAnime[] }) =>
        d.anime.flatMap((a) => {
          const cover = a.images?.find((i) => i.facet === 'Large Cover')?.link ?? a.images?.[0]?.link ?? ''
          return a.animethemes.flatMap((t) => {
            const e = t.animethemeentries[0]
            // the best clip: highest resolution, then the first entry
            const v = [...(e?.videos ?? [])].sort((x, y) => (y.resolution ?? 0) - (x.resolution ?? 0))[0]
            if (!v) return []
            return [
              {
                id: `${malId}-${t.id}`,
                kind: t.type,
                slug: t.slug,
                song: t.song?.title ?? t.slug,
                artists: (t.song?.artists ?? []).map((x) => x.name).join(', '),
                episodes: e.episodes ?? '',
                video: v.link,
                audio: v.audio?.link ?? null,
                anime: a.name,
                cover,
                malId,
              } satisfies Theme,
            ]
          })
        }),
      )
      .catch(() => {
        cache.delete(malId)
        return []
      })
    cache.set(malId, p)
  }
  return p
}

// ---- global music player: keeps playing while you browse ----
interface MusicState {
  queue: Theme[]
  index: number
  playing: boolean
  video: boolean
  play: (queue: Theme[], index?: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  setPlaying: (p: boolean) => void
  setVideo: (v: boolean) => void
  close: () => void
}

export const useMusic = create<MusicState>((set, get) => ({
  queue: [],
  index: 0,
  playing: false,
  video: false,
  play: (queue, index = 0) => set({ queue, index, playing: true }),
  toggle: () => set((s) => ({ playing: !s.playing })),
  next: () => {
    const { index, queue } = get()
    if (index < queue.length - 1) set({ index: index + 1, playing: true })
    else set({ playing: false })
  },
  prev: () => set((s) => ({ index: Math.max(0, s.index - 1), playing: true })),
  setPlaying: (playing) => set({ playing }),
  setVideo: (video) => set({ video }),
  close: () => set({ queue: [], index: 0, playing: false, video: false }),
}))

export const currentTheme = (s: MusicState): Theme | null => s.queue[s.index] ?? null
