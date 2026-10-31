// F5-TTS voice module on the PC: a local server Electron starts on demand (electron/voice-server.py).
// Much livelier than Piper; needs the module installed and a GPU.
import type { Role } from './narrate'

const HOST = 'http://127.0.0.1:47917'

export type F5State = 'none' | 'starting' | 'ready'

let ready: Promise<boolean> | null = null

async function health() {
  try {
    const r = await fetch(`${HOST}/health`)
    return (await r.json()) as { ok: boolean; error: string; voices: string[] }
  } catch {
    return null
  }
}

/** is the module there (starting it if needed); resolves once the model is loaded */
export function f5Ready(): Promise<boolean> {
  ready ??= (async () => {
    const bridge = window.aniplayer?.voice
    if (bridge) {
      if (!(await bridge.start()).installed) return false
    } else if (!(await health())) return false // outside the app: only a server started by hand
    // loading the model takes a while the first time
    for (let i = 0; i < 180; i++) {
      const h = await health()
      if (h?.ok) return true
      if (h?.error) return false
      await new Promise((r) => setTimeout(r, 1000))
    }
    return false
  })()
  ready.then((ok) => !ok && (ready = null))
  return ready
}

/** a quick look without starting anything: is the module installed on this PC */
export async function f5Installed() {
  return !!window.aniplayer?.voice || !!(await health())
}

export async function f5Speak(text: string, voice: string, speed = 1): Promise<Blob> {
  const r = await fetch(`${HOST}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice, speed }) })
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}`)
  return r.blob()
}

const POOL = { m: ['m1', 'm2', 'm3'], f: ['f1', 'f2', 'f3'] }
/** the n-th voice of a gender, by name of its reference clip */
export const f5Voice = (role: Role, n: number) => (role === 'narrator' ? 'narrator' : POOL[role][n % POOL[role].length])
