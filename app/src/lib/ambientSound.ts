// Quiet sounds of a room to read in, made on the spot with Web Audio (no sound files): rain on a window,
// a fire in the hearth, a summer night. Each is a bed of shaped noise with small random events on top.

export type AmbientKind = 'rain' | 'fire' | 'night'

let ctx: AudioContext | null = null
let out: GainNode | null = null
let stopAll: (() => void) | null = null
let playing: AmbientKind | null = null

function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    out = ctx.createGain()
    out.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx
}

/** a few seconds of noise: white, or brown (deep, like a rumble) */
function noise(a: AudioContext, brown: boolean, secs = 4) {
  const b = a.createBuffer(1, a.sampleRate * secs, a.sampleRate)
  const d = b.getChannelData(0)
  let last = 0
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1
    if (brown) {
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5
    } else d[i] = w
  }
  return b
}

function loop(a: AudioContext, buf: AudioBuffer, chain: AudioNode[]) {
  const src = a.createBufferSource()
  src.buffer = buf
  src.loop = true
  let node: AudioNode = src
  for (const n of chain) node = node.connect(n)
  node.connect(out!)
  src.start()
  return src
}

function filter(a: AudioContext, type: BiquadFilterType, freq: number, q = 0.7) {
  const f = a.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  return f
}

function gain(a: AudioContext, v: number) {
  const g = a.createGain()
  g.gain.value = v
  return g
}

/** a short tick of noise through a band: a drop, a crackle, a chirp's attack */
function tick(a: AudioContext, buf: AudioBuffer, freq: number, dur: number, level: number, q = 1.2) {
  const t = a.currentTime
  const src = a.createBufferSource()
  src.buffer = buf
  const bp = filter(a, 'bandpass', freq, q)
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(level, t + Math.min(0.004, dur / 3))
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(bp).connect(g).connect(out!)
  src.start(t, Math.random() * 3, dur + 0.02)
}

/** calls `fn` again and again, each time after `next()` ms */
function every(next: () => number, fn: () => void) {
  let t: ReturnType<typeof setTimeout>
  const go = () => {
    fn()
    t = setTimeout(go, next())
  }
  t = setTimeout(go, next())
  return () => clearTimeout(t)
}

function rain(a: AudioContext) {
  const white = noise(a, false)
  const bed = loop(a, white, [filter(a, 'highpass', 400), filter(a, 'lowpass', 2600), gain(a, 0.16)])
  const low = loop(a, noise(a, true), [filter(a, 'lowpass', 400), gain(a, 0.35)])
  // drops on the glass, now sparse, now in bursts
  const drops = every(
    () => 15 + Math.random() * 90,
    () => tick(a, white, 2500 + Math.random() * 5000, 0.02 + Math.random() * 0.03, 0.03 + Math.random() * 0.08, 4),
  )
  return () => {
    bed.stop()
    low.stop()
    drops()
  }
}

function fire(a: AudioContext) {
  const white = noise(a, false)
  const roar = loop(a, noise(a, true), [filter(a, 'lowpass', 320), gain(a, 0.5)])
  const hiss = loop(a, white, [filter(a, 'bandpass', 1200, 0.4), gain(a, 0.015)])
  // crackles: mostly small, now and then a pop of a knot in the wood
  const crackle = every(
    () => 40 + Math.random() * 260,
    () => {
      const big = Math.random() < 0.08
      tick(a, white, big ? 900 + Math.random() * 800 : 2500 + Math.random() * 4000, big ? 0.05 : 0.006 + Math.random() * 0.012, big ? 0.35 : 0.08 + Math.random() * 0.18, big ? 0.8 : 1.5)
      if (big) for (let k = 1; k < 4; k++) setTimeout(() => tick(a, white, 3000 + Math.random() * 3000, 0.008, 0.1), k * (20 + Math.random() * 40))
    },
  )
  return () => {
    roar.stop()
    hiss.stop()
    crackle()
  }
}

function night(a: AudioContext) {
  const white = noise(a, false)
  // a soft wind in the leaves
  const wind = loop(a, noise(a, true), [filter(a, 'bandpass', 500, 0.5), gain(a, 0.25)])
  // crickets: quick trains of high chirps
  const chirp = (f: number, lvl: number) => {
    const t = a.currentTime
    const o = a.createOscillator()
    o.frequency.value = f
    const g = a.createGain()
    g.gain.value = 0
    for (let k = 0; k < 3; k++) {
      g.gain.setValueAtTime(0, t + k * 0.05)
      g.gain.linearRampToValueAtTime(lvl, t + k * 0.05 + 0.008)
      g.gain.linearRampToValueAtTime(0, t + k * 0.05 + 0.03)
    }
    o.connect(g).connect(out!)
    o.start(t)
    o.stop(t + 0.2)
  }
  const crickets = every(
    () => 380 + Math.random() * 900,
    () => chirp(4200 + Math.random() * 600, 0.012 + Math.random() * 0.02),
  )
  const far = every(
    () => 2500 + Math.random() * 6000,
    () => tick(a, white, 700, 0.12, 0.02, 3),
  )
  return () => {
    wind.stop()
    crickets()
    far()
  }
}

/** starts (or switches to) a sound; 'off' stops it. Must be first called from a tap or a key. */
export function setAmbient(kind: AmbientKind | 'off', volume: number) {
  if (kind === 'off') {
    stopAll?.()
    stopAll = null
    playing = null
    return
  }
  const a = audio()
  if (!a || !out) return
  out.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)) * 1.2, a.currentTime, 0.2)
  if (playing === kind) return
  stopAll?.()
  playing = kind
  stopAll = kind === 'rain' ? rain(a) : kind === 'fire' ? fire(a) : night(a)
}
