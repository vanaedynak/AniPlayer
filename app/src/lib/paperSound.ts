// Paper sounds for the readers, made on the spot with Web Audio (no sound files): the swish of a page
// turning over, and a short rustle each time a held page is shaken.

let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null

function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    // a second of rough noise: paper is mostly hiss with a crackle in it
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = noise.getChannelData(0)
    let last = 0
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1
      last = last * 0.6 + white * 0.4
      d[i] = last * (Math.random() < 0.002 ? 3 : 1)
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx
}

/** a burst of filtered noise: `freq` sweeps to `to` over `dur` seconds, loudest at `peak` of the way */
function burst(dur: number, freq: number, to: number, gain: number, peak = 0.3) {
  const a = audio()
  if (!a || !noise) return
  const t = a.currentTime
  const src = a.createBufferSource()
  src.buffer = noise
  src.playbackRate.value = 0.8 + Math.random() * 0.4
  const bp = a.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 0.9
  bp.frequency.setValueAtTime(freq, t)
  bp.frequency.exponentialRampToValueAtTime(to, t + dur)
  const hp = a.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 500
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + dur * peak)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(bp).connect(hp).connect(g).connect(a.destination)
  src.start(t, Math.random() * 0.5, dur + 0.05)
}

/** a page turning over */
export function turnSound() {
  burst(0.32, 1800, 5200, 0.5, 0.35)
  // the soft slap of the page landing
  setTimeout(() => burst(0.09, 900, 600, 0.25, 0.2), 230)
}

let lastRustle = 0
/** a held page shaken: `strength` from 0 to 1 */
export function rustleSound(strength: number) {
  const now = performance.now()
  if (now - lastRustle < 70) return
  lastRustle = now
  const s = Math.min(1, Math.max(0.15, strength))
  burst(0.06 + s * 0.08, 2500 + Math.random() * 2500, 3500 + Math.random() * 3000, 0.12 + s * 0.35, 0.25)
}

/** the browser lets sound start only after a tap or a key: the first one opens it */
export function wakeAudio() {
  audio()
}
