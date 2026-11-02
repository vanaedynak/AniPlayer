// Torrent streaming for the desktop app: AniLibria's own releases (WEBRip/BDRip at full bitrate) are fetched
// piece by piece in playback order and served to the <video> over a local HTTP server with Range support,
// so playback starts in seconds and seeking jumps the download to the new spot.
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

const CACHE = path.join(os.tmpdir(), 'anyflow-torrents')
// .torrent files come only from AniLibria's API, by numeric torrent id
const HOSTS = ['https://anilibria.top', 'https://aniliberty.top', 'https://api.anilibria.app']
const TYPES = { '.mkv': 'video/webm', '.webm': 'video/webm', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.avi': 'video/x-msvideo' }
const VIDEO = /\.(mkv|mp4|m4v|webm|avi)$/i

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
  return {
    infoHash: t.infoHash,
    files: t.files.map((f, index) => ({ index, name: f.name, length: f.length })).filter((f) => VIDEO.test(f.name)),
  }
}

/** adds AniLibria torrent `id` (nothing is downloaded until a file is played) and lists its videos */
async function open(id) {
  if (!/^\d{1,9}$/.test(String(id))) throw new Error('bad torrent id')
  const c = await getClient()
  const buf = await fetchTorrent(id)
  const existing = await c.get(buf)
  if (existing) {
    lastUse.set(existing.infoHash, Date.now())
    return existing.ready ? info(existing) : new Promise((ok) => existing.once('ready', () => ok(info(existing))))
  }
  return new Promise((ok, fail) => {
    const t = c.add(buf, { path: CACHE, deselect: true, destroyStoreOnDestroy: true })
    lastUse.set(t.infoHash, Date.now())
    t.once('ready', () => ok(info(t)))
    t.once('error', fail)
  })
}

function streamUrl(infoHash, index) {
  return `http://127.0.0.1:${port}/${token}/${infoHash}/${index}`
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

async function serve(req, res) {
  const [, tok, hash, idx] = (req.url ?? '').split('/')
  res.setHeader('Access-Control-Allow-Origin', '*')
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
  stream.pipe(res)
}

function shutdown() {
  if (!client) return
  try {
    client.destroy()
    server?.close()
    fs.rmSync(CACHE, { recursive: true, force: true })
  } catch {}
}

module.exports = { open, streamUrl, stats, drop, warm, ready, shutdown }
