// Real frames for episodes AniLibria has no preview for: a hidden player loads a few seconds from
// the middle of the episode and takes one small picture. Frames are kept on this device, so each
// episode is grabbed once. Where that cannot work (no MSE, the stream refuses), Shikimori's
// screenshots of the anime stand in.
import Hls from 'hls.js'
import { storage } from './offline'
import { shikiScreens } from './shikimori'
import type { Episode } from './api'

const W = 384
const H = 216
const memory = new Map<string, string>()
const failed = new Set<string>()
const file = (key: string) => `frames/${key}.txt`

type Job = { key: string; url: string; rank: number; done: (src: string) => void; fail: () => void }
const waiting = new Map<string, Job>()
let rank = 0
let busy = false

/** a frame from the middle of the episode, or null when it cannot be grabbed */
export function episodeFrame(e: Episode): Promise<string | null> {
  const key = `${e.release_id}-${e.ordinal}`
  if (memory.has(key)) return Promise.resolve(memory.get(key)!)
  const url = e.hls_480 || e.hls_720 || e.hls_1080
  if (!url || failed.has(key) || !Hls.isSupported()) return Promise.resolve(null)
  const queued = waiting.get(key)
  if (queued) {
    // the card was seen again: it goes first
    queued.rank = ++rank
    return new Promise((ok) => {
      const { done, fail } = queued
      queued.done = (s) => (done(s), ok(s))
      queued.fail = () => (fail(), ok(null))
    })
  }
  return new Promise((ok) => {
    waiting.set(key, { key, url, rank: ++rank, done: ok, fail: () => ok(null) })
    void work()
  })
}

async function work() {
  if (busy) return
  busy = true
  while (waiting.size) {
    // newest request first: the cards on screen now
    const job = [...waiting.values()].reduce((a, b) => (b.rank > a.rank ? b : a))
    waiting.delete(job.key)
    try {
      const saved = await storage
        .read(file(job.key))
        .then((b) => new TextDecoder().decode(b))
        .catch(() => '')
      const src = saved || (await grab(job.url))
      memory.set(job.key, src)
      if (!saved) void storage.write(file(job.key), src).catch(() => {})
      job.done(src)
    } catch {
      failed.add(job.key)
      job.fail()
    }
  }
  busy = false
}

function grab(url: string): Promise<string> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  const hls = new Hls({ autoStartLoad: false, maxBufferLength: 4, maxMaxBufferLength: 8, enableWorker: false })
  return new Promise<string>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('timeout')), 25_000)
    let target = 0
    let tries = 0
    const shoot = () => {
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const g = c.getContext('2d')!
      g.drawImage(video, 0, 0, W, H)
      // a black or faded frame (scene change) is retried a bit later
      const px = g.getImageData(0, 0, W, H).data
      let sum = 0
      for (let i = 0; i < px.length; i += 64) sum += px[i] + px[i + 1] + px[i + 2]
      if (sum / (px.length / 64) / 3 < 28 && tries++ < 2) {
        target += 25
        video.currentTime = target
        return
      }
      clearTimeout(timer)
      ok(c.toDataURL('image/jpeg', 0.72))
    }
    video.addEventListener('seeked', () => video.readyState >= 2 && shoot())
    video.addEventListener('loadeddata', () => {
      if (Math.abs(video.currentTime - target) < 3) shoot()
      else video.currentTime = target
    })
    hls.on(Hls.Events.ERROR, (_e, d) => {
      if (d.fatal) {
        clearTimeout(timer)
        fail(new Error(d.details))
      }
    })
    hls.on(Hls.Events.LEVEL_LOADED, (_e, d) => {
      if (target) return
      // past the opening, before the ending
      target = Math.max(1, d.details.totalduration * 0.38)
      hls.startLoad(target)
      video.currentTime = target
    })
    hls.loadSource(url)
    hls.attachMedia(video)
  }).finally(() => {
    hls.destroy()
    video.removeAttribute('src')
    video.load()
  })
}

/** a Shikimori screenshot of the anime for episode n: not that exact episode, but a real frame of the show */
export async function screenshotFor(malId: number, ordinal: number): Promise<string | null> {
  const list = await shikiScreens(malId).catch(() => [] as string[])
  if (!list.length) return null
  return list[(Math.max(1, Math.floor(ordinal)) - 1) % list.length]
}
