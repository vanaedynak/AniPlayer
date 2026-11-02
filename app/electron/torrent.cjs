// Torrent streaming for the desktop app: AniLibria's own releases, or any magnet link / .torrent file the user
// opens, fetched piece by piece in playback order and served to the <video> over a local HTTP server with
// Range support, so playback starts in seconds and seeking jumps the download to the new spot.
// Subtitles inside an mkv are read out of the same bytes on their way to the player.
const http = require('node:http')
const { Transform } = require('node:stream')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

const CACHE = path.join(os.tmpdir(), 'anyflow-torrents')
// .torrent files come only from AniLibria's API, by numeric torrent id
const HOSTS = ['https://anilibria.top', 'https://aniliberty.top', 'https://api.anilibria.app']
const TYPES = { '.mkv': 'video/webm', '.webm': 'video/webm', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.avi': 'video/x-msvideo' }
const VIDEO = /\.(mkv|mp4|m4v|webm|avi)$/i
const SUBS = /\.(ass|ssa|srt|vtt)$/i
const METADATA_TIMEOUT = 90_000

let client = null
let server = null
let port = 0
const token = crypto.randomBytes(12).toString('hex')
const lastUse = new Map() // infoHash -> time the player last asked for it

async function getClient() {
  if (client) return client
  const { default: WebTorrent } = await import('webtorrent')
  // old runs' pieces: nothing is kept between sessions, the disk is not a library
  fs.rmSync(CACHE, { recursive: true, force: true })
  client = new WebTorrent({ maxConns: 80 })
  client.on('error', (e) => console.warn('[torrent]', e?.message ?? e))
  await new Promise((ok) => {
    server = http.createServer(serve)
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port
      ok()
    })
  })
  // a torrent nobody watched for 10 minutes is dropped together with its pieces
  setInterval(() => {
    for (const t of [...client.torrents]) if (Date.now() - (lastUse.get(t.infoHash) ?? 0) > 10 * 60_000) drop(t.infoHash)
  }, 60_000).unref()
  return client
}

async function fetchTorrent(id) {
  let last
  for (const h of HOSTS) {
    try {
      const res = await fetch(`${h}/api/v1/anime/torrents/${id}/file`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf[0] !== 0x64) throw new Error('not a torrent') // bencoded dictionary starts with "d"
      return buf
    } catch (e) {
      last = e
    }
  }
  throw last
}

function info(t) {
  const list = (re) => t.files.map((f, index) => ({ index, name: f.name, path: f.path, length: f.length })).filter((f) => re.test(f.name))
  return { infoHash: t.infoHash, name: t.name, files: list(VIDEO), subs: list(SUBS) }
}

/** waits for a torrent's metadata: a magnet link has to fetch it from peers first */
function whenReady(t) {
  if (t.ready) return Promise.resolve(info(t))
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('раздача не отвечает: нет пиров с её описанием')), METADATA_TIMEOUT)
    t.once('ready', () => {
      clearTimeout(timer)
      ok(info(t))
    })
    t.once('error', (e) => {
      clearTimeout(timer)
      fail(e)
    })
  })
}

async function addTorrent(id) {
  const c = await getClient()
  const existing = await c.get(id)
  const t = existing ?? c.add(id, { path: CACHE, deselect: true, destroyStoreOnDestroy: true })
  // a magnet that never got its metadata must not linger
  if (!existing) t.once('error', () => {})
  lastUse.set(t.infoHash, Date.now())
  try {
    return await whenReady(t)
  } catch (e) {
    if (!existing) t.destroy({ destroyStore: true })
    throw e
  }
}

/** any magnet link the user pastes */
async function openMagnet(uri) {
  if (typeof uri !== 'string' || !/^magnet:\?/i.test(uri.trim()) || !/xt=urn:bt(ih|mh):/i.test(uri)) throw new Error('это не magnet-ссылка')
  return addTorrent(uri.trim())
}

/** a .torrent file the user picked */
async function openFile(bytes) {
  const buf = Buffer.from(bytes)
  if (buf[0] !== 0x64) throw new Error('это не .torrent файл')
  return addTorrent(buf)
}

/** adds AniLibria torrent `id` (nothing is downloaded until a file is played) and lists its videos */
async function open(id) {
  if (!/^\d{1,9}$/.test(String(id))) throw new Error('bad torrent id')
  return addTorrent(await fetchTorrent(id))
}

function streamUrl(infoHash, index) {
  return `http://127.0.0.1:${port}/${token}/${infoHash}/${index}`
}
/** a whole small file as is: subtitles lying next to the videos */
function rawUrl(infoHash, index) {
  return `http://127.0.0.1:${port}/${token}/raw/${infoHash}/${index}`
}
/** subtitles found inside an mkv so far, as JSON */
function subsUrl(infoHash, index) {
  return `http://127.0.0.1:${port}/${token}/subs/${infoHash}/${index}`
}
/** what the page gets: every video with its stream and embedded-subtitle addresses, every subtitle file with its own */
function withUrls(i) {
  return {
    ...i,
    files: i.files.map((f) => ({ ...f, url: streamUrl(i.infoHash, f.index), subs: subsUrl(i.infoHash, f.index) })),
    subs: i.subs.map((f) => ({ ...f, url: rawUrl(i.infoHash, f.index) })),
  }
}

async function find(infoHash) {
  return client ? await client.get(infoHash) : null
}

async function stats(infoHash, index) {
  const t = await find(infoHash)
  if (!t) return null
  lastUse.set(infoHash, Date.now())
  const f = t.files[index]
  return { peers: t.numPeers, down: t.downloadSpeed, progress: f ? f.progress : t.progress }
}

async function drop(infoHash) {
  const t = await find(infoHash)
  lastUse.delete(infoHash)
  for (const k of [...embedded.keys()]) if (k.startsWith(infoHash)) embedded.delete(k)
  if (t) t.destroy({ destroyStore: true })
}

// every read in flight, by torrent. Playback reads of another file stop when the next episode opens;
// warm-ups (the next episode, the spot playback will switch to) run until they have their bytes
const reads = new Map() // infoHash -> Set<{ idx, stream, keep }>
function track(hash, idx, stream, keep = false) {
  const set = reads.get(hash) ?? new Set()
  reads.set(hash, set)
  const r = { idx: String(idx), stream, keep }
  set.add(r)
  stream.once('close', () => set.delete(r))
}
function stopOthers(hash, idx) {
  for (const r of reads.get(hash) ?? []) if (!r.keep && r.idx !== String(idx)) r.stream.destroy()
}
function readRange(hash, idx, file, start, end, keep) {
  start = Math.max(0, Math.min(start, file.length - 1))
  end = Math.max(start, Math.min(end, file.length - 1))
  const s = file.createReadStream({ start, end })
  track(hash, idx, s, keep)
  s.on('error', () => {})
  s.resume()
}

// an mkv keeps its seek index (Cues) at the very end: without it the first seek takes half a minute
const TAIL = 2_000_000
const tails = new Set()
function prefetchTail(hash, idx, file, keep = false) {
  const key = `${hash}/${idx}`
  if (tails.has(key)) return
  tails.add(key)
  readRange(hash, idx, file, file.length - TAIL, file.length - 1, keep)
}

/** downloads bytes [from, to] of a file (and its tail) ahead of playback, in the background */
async function warm(infoHash, index, from, to) {
  const t = await find(infoHash)
  const f = t?.files[index]
  if (!f) return
  lastUse.set(infoHash, Date.now())
  prefetchTail(infoHash, index, f, true)
  readRange(infoHash, index, f, from, to, true)
}

/** share of bytes [from, to] (plus the tail) already on disk; 1 means playback from there starts at once */
async function ready(infoHash, index, from, to) {
  const t = await find(infoHash)
  const f = t?.files[index]
  if (!f || !t.bitfield) return 0
  lastUse.set(infoHash, Date.now())
  const pl = t.pieceLength
  const pieces = new Set()
  const add = (a, b) => {
    const first = Math.floor((f.offset + Math.max(0, a)) / pl)
    const last = Math.floor((f.offset + Math.min(b, f.length - 1)) / pl)
    for (let i = first; i <= last; i++) pieces.add(i)
  }
  add(from, to)
  add(f.length - TAIL, f.length - 1)
  let have = 0
  for (const i of pieces) if (t.bitfield.get(i)) have++
  return have / pieces.size
}

// ---------- subtitles inside an mkv ----------
// every byte range the player reads also goes through a subtitle parser; the cues pile up per file
// and the page polls them. Seeking far ahead finds the lines there as soon as those bytes arrive.
let Subtitles = null
const embedded = new Map() // `${hash}/${idx}` -> { tracks: Map, scale, cues: Map<track, Map<time, cue>> }
function subState(key) {
  let st = embedded.get(key)
  if (!st) embedded.set(key, (st = { tracks: new Map(), scale: 1, cues: new Map() }))
  return st
}
function subtitleTap(key, start) {
  Subtitles ??= require('matroska-subtitles')
  const st = subState(key)
  const p = new Subtitles.SubtitleStream()
  // mid-file: no header here, so reuse what the first read learned and start at the next cluster
  let synced = start === 0
  let carry = Buffer.alloc(0)
  if (!synced) {
    if (!st.tracks.size) return null
    p.subtitleTracks = st.tracks
    p.timecodeScale = st.scale
  }
  p.on('tracks', () => {
    st.tracks = p.subtitleTracks
    st.scale = p.timecodeScale
  })
  p.on('subtitle', (s, track) => {
    const m = st.cues.get(track) ?? new Map()
    st.cues.set(track, m)
    m.set(s.time, [s.time, s.duration, s.text, s.style ?? ''])
  })
  p.on('error', () => {})
  p.resume()
  return new Transform({
    transform(chunk, _enc, cb) {
      try {
        if (synced) p.write(chunk)
        else {
          // a cluster id split across two chunks still has to be found
          const buf = Buffer.concat([carry, chunk])
          const at = clusterStart(buf)
          if (at >= 0) {
            synced = true
            p.write(buf.subarray(at))
          } else carry = buf.subarray(Math.max(0, buf.length - 32))
        }
      } catch {}
      cb(null, chunk)
    },
  })
}
// a Cluster element: its id, a size, then the cluster Timecode (0xE7), or first a CRC-32 (0xBF, 4 bytes) as ffmpeg writes it
function clusterStart(buf) {
  for (let i = buf.indexOf(CLUSTER); i >= 0 && i < buf.length - 20; i = buf.indexOf(CLUSTER, i + 1)) {
    const first = buf[i + 4]
    if (!first) continue
    let j = i + 4 + (8 - Math.floor(Math.log2(first)))
    if (buf[j] === 0xbf && buf[j + 1] === 0x84) j += 6
    if (buf[j] === 0xe7) return i
  }
  return -1
}
const CLUSTER = Buffer.from([0x1f, 0x43, 0xb6, 0x75])
function subsJson(key) {
  const st = embedded.get(key)
  if (!st) return { tracks: [], cues: {} }
  return {
    tracks: [...st.tracks.values()].map((t) => ({ number: t.number, language: t.language, name: t.name, type: t.type })),
    cues: Object.fromEntries([...st.cues].map(([n, m]) => [n, [...m.values()]])),
  }
}

async function serveSmall(res, hash, idx, kind) {
  const t = /^[0-9a-f]{40}$/.test(hash ?? '') ? await find(hash) : null
  const file = t?.files[Number(idx)]
  if (!file) {
    res.statusCode = 404
    return res.end()
  }
  lastUse.set(hash, Date.now())
  if (kind === 'subs') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.end(JSON.stringify(subsJson(`${hash}/${idx}`)))
  }
  if (!SUBS.test(file.name) || file.length > 20_000_000) {
    res.statusCode = 403
    return res.end()
  }
  res.setHeader('Content-Type', 'application/octet-stream')
  const s = file.createReadStream()
  s.on('error', () => res.destroy())
  res.on('close', () => s.destroy())
  s.pipe(res)
}

async function serve(req, res) {
  const parts = (req.url ?? '').split('?')[0].split('/')
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (parts[1] === token && (parts[2] === 'raw' || parts[2] === 'subs')) return serveSmall(res, parts[3], parts[4], parts[2])
  const [, tok, hash, idx] = parts
  const t = tok === token && /^[0-9a-f]{40}$/.test(hash ?? '') ? await find(hash) : null
  const file = t?.files[Number(idx)]
  if (!file) {
    res.statusCode = 404
    return res.end()
  }
  lastUse.set(hash, Date.now())
  const size = file.length
  stopOthers(hash, idx)
  prefetchTail(hash, idx, file)
  const type = TYPES[path.extname(file.name).toLowerCase()] ?? 'application/octet-stream'
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', type)
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
  let start = 0
  let end = size - 1
  if (m) {
    if (m[1]) start = Number(m[1])
    if (m[2]) end = Math.min(Number(m[2]), size - 1)
    if (!m[1] && m[2]) [start, end] = [size - Number(m[2]), size - 1]
    if (start > end || start >= size) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      return res.end()
    }
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
  }
  res.setHeader('Content-Length', end - start + 1)
  if (req.method === 'HEAD') return res.end()
  // the read stream asks for its pieces first: playback order wins over the rest of the torrent
  const stream = file.createReadStream({ start, end })
  track(hash, idx, stream)
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  const tap = /\.mkv$/i.test(file.name) ? subtitleTap(`${hash}/${idx}`, start) : null
  if (tap) stream.pipe(tap).pipe(res)
  else stream.pipe(res)
}

function shutdown() {
  if (!client) return
  try {
    client.destroy()
    server?.close()
    fs.rmSync(CACHE, { recursive: true, force: true })
  } catch {}
}

module.exports = { open, openMagnet, openFile, withUrls, streamUrl, stats, drop, warm, ready, shutdown }
