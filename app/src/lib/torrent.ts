// AniLibria's own torrents as a player source (desktop only): the same dub as the HLS stream, but the full
// WEBRip/BDRip bitrate, about five times the data per episode. Electron downloads it in playback order.
import type { Torrent } from './api'

export const torrentSupported = () => !!window.aniplayer?.torrent

export type TorrentFile = { index: number; name: string; length: number; url: string }

const QUALITY: Record<string, number> = { '2160p': 4, '1440p': 3, '1080p': 2, '720p': 1 }
const TYPE: Record<string, number> = { BDRip: 3, 'BD-Rip': 3, 'WEB-DL': 2, WEBRip: 1 }

/** episodes a torrent holds, from AniLibria's "1-12" style description */
function covers(t: Torrent, ordinal: number) {
  const ranges = (t.description ?? '').match(/\d+(\.\d+)?(\s*-\s*\d+(\.\d+)?)?/g)
  if (!ranges) return true
  return ranges.some((r) => {
    const [a, b = a] = r.split('-').map(Number)
    return ordinal >= a && ordinal <= b
  })
}

function count(t: Torrent) {
  return (t.description ?? '').match(/\d+(\.\d+)?(\s*-\s*\d+(\.\d+)?)?/g)?.reduce((n, r) => {
    const [a, b = a] = r.split('-').map(Number)
    return n + Math.max(1, Math.floor(b) - Math.floor(a) + 1)
  }, 0) ?? 1
}

/** the torrents that hold this episode, best picture first; AVC before HEVC, which older graphics cards can't decode */
export function torrentsFor(list: Torrent[], ordinal: number) {
  return list
    .filter((t) => t.seeders > 0 && covers(t, ordinal))
    .sort(
      (a, b) =>
        (QUALITY[b.quality?.value ?? ''] ?? 0) - (QUALITY[a.quality?.value ?? ''] ?? 0) ||
        (TYPE[b.type?.value ?? ''] ?? 0) - (TYPE[a.type?.value ?? ''] ?? 0) ||
        Number(/HEVC|265/i.test(a.codec?.label ?? '')) - Number(/HEVC|265/i.test(b.codec?.label ?? '')),
    )
}

export function torrentTitle(t: Torrent) {
  return [t.type?.value, t.quality?.value, t.codec?.label].filter(Boolean).join(' · ')
}

/** "≈1.5 ГБ на серию · 15 сидов" */
export function torrentHint(t: Torrent) {
  const per = t.size / count(t) / 1024 ** 3
  return `≈${per >= 1 ? per.toFixed(1) + ' ГБ' : Math.round(per * 1024) + ' МБ'} на серию · ${t.seeders} сид.`
}

/**
 * the file of episode `ordinal`. The clearest markers go first: "[05]" before " - 05 " before "E05" before "_05_",
 * so the "2" of "Terrace_2_[09]" is not taken for episode 2.
 */
export function episodeFile(files: TorrentFile[], ordinal: number): TorrentFile | null {
  if (files.length === 1) return files[0]
  const n = `0*${Math.floor(ordinal)}`
  const patterns = [`\\[${n}(v\\d)?\\]`, `[\\s_]-[\\s_]${n}(v\\d)?[\\s_.\\[]`, `[Ee](p|pisode)?${n}(v\\d)?[^\\d]`, `[\\s_]${n}(v\\d)?[\\s_.]`]
  for (const p of patterns) {
    const re = new RegExp(p)
    const hit = files.find((f) => re.test(f.name.replace(/\d{3,4}p|[xh]\.?26[45]/gi, '')))
    if (hit) return hit
  }
  return null
}
