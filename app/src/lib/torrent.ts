// Torrents as a player source (desktop only). AniLibria's own: the same dub as the HLS stream at the full
// WEBRip/BDRip bitrate. Or any magnet link / .torrent file the user opens, with its dubs and subtitles.
// Electron downloads it in playback order.
import { useEffect, useState } from 'react'
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

// extras ride along in BD releases (NCOP, previews, menus): never mistaken for episode 1
export const EXTRA = /(^|[\s_\[(.\\/-])(NC(OP|ED)|OP|ED|PV|CM|SP|OVA|Menu|Preview|Trailer|Teaser|Extras?|Bonus|Special|Creditless)\d*([\s_\])./-]|$)/i

/**
 * the file of episode `ordinal`. The clearest markers go first: "[05]" before " - 05 " before "E05" before "_05_",
 * so the "2" of "Terrace_2_[09]" is not taken for episode 2.
 */
export function episodeFile<F extends { name: string; path?: string }>(files: F[], ordinal: number): F | null {
  const main = files.filter((f) => !EXTRA.test(f.path ?? f.name))
  const pool = main.length ? main : files
  if (pool.length === 1) return pool[0]
  const n = `0*${Math.floor(ordinal)}`
  const patterns = [`\\[${n}(v\\d)?\\]`, `[\\s_]-[\\s_]${n}(v\\d)?[\\s_.\\[(]`, `[Ee](p|pisode)?${n}(v\\d)?[^\\d]`, `[\\s_]${n}(v\\d)?[\\s_.]`]
  for (const p of patterns) {
    const re = new RegExp(p)
    const hit = pool.find((f) => re.test(f.name.replace(/\d{3,4}p|[xh]\.?26[45]|10.?bit/gi, '')))
    if (hit) return hit
  }
  return null
}

/** the episode number a file name carries, if any (for listing a torrent nobody mapped yet) */
export function episodeOf(name: string): number | null {
  const clean = name.replace(/\d{3,4}p|[xh]\.?26[45]|10.?bit|\[[0-9A-F]{8}\]/gi, '')
  const m = /\[(\d{1,4})(v\d)?\]|[\s_]-[\s_](\d{1,4})(v\d)?[\s_.\[(]|[Ee](?:p|pisode)?(\d{1,4})(v\d)?[^\d]/.exec(clean)
  const v = m && (m[1] ?? m[3] ?? m[5])
  return v ? Number(v) : null
}

// ---------- any torrent the user brings ----------

export type TorrentVideo = TorrentFile & { path: string; subs: string }
export type TorrentSub = { index: number; name: string; path: string; length: number; url: string }
export type TorrentInfo = { infoHash: string; name: string; files: TorrentVideo[]; subs: TorrentSub[] }

/** a source the player can stream: one of AniLibria's torrents or one the user opened */
export interface TorSource {
  key: string
  title: string
  open: () => Promise<TorrentInfo>
  /** set for AniLibria's own torrents: they are offered per title and remembered */
  anilibria?: Torrent
}

export function anilibriaSource(t: Torrent): TorSource {
  return { key: `al:${t.id}`, title: torrentTitle(t), anilibria: t, open: () => window.aniplayer!.torrent!.open(t.id) }
}

export function userSource(info: TorrentInfo): TorSource {
  return { key: `u:${info.infoHash}`, title: info.name, open: async () => info }
}

/** opens a pasted magnet link or a picked .torrent file */
export async function openUserTorrent(input: string | File): Promise<TorrentInfo> {
  const t = window.aniplayer?.torrent
  if (!t) throw new Error('Свои торренты открываются в приложении для ПК')
  if (typeof input === 'string') return t.openMagnet(input.trim())
  return t.openFile(new Uint8Array(await input.arrayBuffer()))
}

/** a whole torrent saved into a folder on the PC */
export type TorrentSave = {
  hash: string
  name: string
  folder: string
  size: number
  progress: number
  done: boolean
  paused: boolean
  down: number
  peers: number
  added: number
}

export const savesSupported = () => !!window.aniplayer?.torrent?.saves

/** the saved torrents, refreshed every two seconds while something still downloads */
export function useTorrentSaves() {
  const [list, setList] = useState<TorrentSave[]>([])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = window.aniplayer?.torrent
    if (!t?.saves) return
    let alive = true
    let timer = 0
    const load = () =>
      t.saves!().then((l) => {
        if (!alive) return
        setList(l)
        if (l.some((s) => !s.done && !s.paused)) timer = window.setTimeout(load, 2000)
      })
    void load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [tick])
  return { list, refresh: () => setTick((n) => n + 1) }
}

/** subtitle files lying next to the videos that belong to this one: same name, or the same episode number */
export function subsFor(info: TorrentInfo, video: TorrentVideo, ordinal: number | null): TorrentSub[] {
  const base = video.name.replace(/\.[^.]+$/, '').toLowerCase()
  const same = info.subs.filter((s) => s.name.toLowerCase().startsWith(base))
  if (same.length) return same
  if (info.files.length === 1) return info.subs
  if (ordinal == null) return []
  return info.subs.filter((s) => episodeOf(s.name) === Math.floor(ordinal))
}

// ---------- subtitles ----------

export type Cue = { start: number; end: number; text: string }

/** subtitle files are utf-8 or, from older Russian releases, windows-1251 */
export function decodeText(buf: ArrayBuffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('windows-1251').decode(buf)
  }
}

/** an ASS line as plain text: override tags out, \N as a line break; drawings (\p1) are dropped */
export function assText(t: string) {
  if (/\{[^}]*\\p[1-9]/.test(t)) return ''
  return t
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .trim()
}

const clock = (h: string, m: string, sec: string, frac = '0') => Number(h) * 3600 + Number(m) * 60 + Number(sec) + Number(`0.${frac}`)

export function parseSubs(name: string, text: string): Cue[] {
  const out: Cue[] = []
  if (/\.(ass|ssa)$/i.test(name)) {
    let format: string[] = []
    for (const line of text.split(/\r?\n/)) {
      if (/^Format:/i.test(line) && !format.length && /Start/i.test(line) && /Text/i.test(line)) format = line.slice(7).split(',').map((x) => x.trim().toLowerCase())
      const m = /^Dialogue:\s*(.*)$/i.exec(line)
      if (!m || !format.length) continue
      const parts = m[1].split(',')
      const at = (k: string) => parts[format.indexOf(k)] ?? ''
      const text = assText(parts.slice(format.indexOf('text')).join(','))
      const a = /(\d+):(\d+):(\d+)[.,](\d+)/.exec(at('start'))
      const b = /(\d+):(\d+):(\d+)[.,](\d+)/.exec(at('end'))
      if (a && b && text) out.push({ start: clock(a[1], a[2], a[3], a[4]), end: clock(b[1], b[2], b[3], b[4]), text })
    }
  } else {
    // srt and vtt: "00:00:01,500 --> 00:00:04,000" then the text up to an empty line
    const re = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)\s*-->\s*(?:(\d+):)?(\d+):(\d+)[.,](\d+)[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/g
    for (const m of text.replace(/\r/g, '').matchAll(re)) {
      const t = m[9].replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').trim()
      if (t) out.push({ start: clock(m[1] ?? '0', m[2], m[3], m[4]), end: clock(m[5] ?? '0', m[6], m[7], m[8]), text: t })
    }
  }
  return out.sort((x, y) => x.start - y.start)
}

/** an mkv's subtitle tracks as the engine reads them out of the stream */
export type EmbeddedSubs = {
  tracks: { number: number; language?: string; name?: string; type: string }[]
  cues: Record<string, [number, number, string, string][]>
}

export function embeddedCues(e: EmbeddedSubs, track: number): Cue[] {
  const t = e.tracks.find((x) => x.number === track)
  return (e.cues[track] ?? [])
    .map(([ms, dur, text]) => ({ start: ms / 1000, end: (ms + dur) / 1000, text: t && /ass|ssa/.test(t.type) ? assText(text) : text.replace(/<[^>]+>/g, '').trim() }))
    .filter((c) => c.text)
    .sort((x, y) => x.start - y.start)
}

const LANG: Record<string, string> = { rus: 'Русские', ru: 'Русские', eng: 'Английские', en: 'Английские', jpn: 'Японские', ja: 'Японские', ukr: 'Украинские', uk: 'Украинские' }
export const trackLabel = (name: string | undefined, language: string | undefined, fallback: string) =>
  [name, language ? (LANG[language.toLowerCase()] ?? language) : ''].filter(Boolean).join(' · ') || fallback
