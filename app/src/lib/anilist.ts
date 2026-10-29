// AniList progress sync. Token comes from the implicit-grant "pin" page and is
// stored in synced prefs, so entering it once covers every device.
import { useStore } from './store'

const ENDPOINT = 'https://graphql.anilist.co'
export const anilistAuthUrl = (clientId: string) =>
  `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`

async function gql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors?.length) throw new Error(json.errors[0].message)
  return json.data as T
}

export async function anilistViewer(token: string) {
  const d = await gql<{ Viewer: { id: number; name: string; avatar: { medium: string } } }>(
    'query { Viewer { id name avatar { medium } } }',
    {},
    token,
  )
  return d.Viewer
}

const mediaCache = new Map<number, { id: number; episodes: number | null }>()

/** raise AniList progress for the title to `episode`; never lowers it */
export async function anilistReportEpisode(malId: number | null | undefined, episode: number) {
  const { anilistToken, anilistSync } = useStore.getState().prefs
  if (!anilistToken || !anilistSync || !malId) return
  const ep = Math.floor(episode)
  try {
    const d = await gql<{
      Media: { id: number; episodes: number | null; mediaListEntry: { progress: number; status: string } | null } | null
    }>(
      'query ($mal: Int) { Media(idMal: $mal, type: ANIME) { id episodes mediaListEntry { progress status } } }',
      { mal: malId },
      anilistToken,
    )
    const m = d.Media
    if (!m) return
    mediaCache.set(malId, { id: m.id, episodes: m.episodes })
    const entry = m.mediaListEntry
    if (entry && (entry.progress >= ep || entry.status === 'COMPLETED')) return
    const done = m.episodes != null && ep >= m.episodes
    await gql(
      'mutation ($id: Int, $p: Int, $s: MediaListStatus) { SaveMediaListEntry(mediaId: $id, progress: $p, status: $s) { id } }',
      { id: m.id, p: m.episodes ? Math.min(ep, m.episodes) : ep, s: done ? 'COMPLETED' : 'CURRENT' },
      anilistToken,
    )
  } catch (e) {
    console.warn('[anilist]', e)
  }
}
