// Piper: neural text-to-speech that runs right in the app (WebAssembly), on every device, offline once
// a voice is downloaded (~60 MB each, kept in the browser's private storage).
import { TtsSession } from '@mintplex-labs/piper-tts-web'
import type { Role } from './narrate'

export const PIPER_VOICES = {
  narrator: 'ru_RU-dmitri-medium',
  m: ['ru_RU-denis-medium', 'ru_RU-ruslan-medium'],
  f: ['ru_RU-irina-medium'],
}

/** a voice and how much higher it is pitched: Piper has one Russian woman, so the second girl is her, a little higher */
export interface Voice {
  id: string
  pitch: number
}

export type DownloadProgress = (voice: string, part: number) => void

// one session per voice (the library shares a single one, which can't switch models)
const sessions = new Map<string, Promise<TtsSession>>()
function session(id: string, progress?: DownloadProgress) {
  let s = sessions.get(id)
  if (!s) {
    TtsSession._instance = null
    s = TtsSession.create({ voiceId: id, progress: (p) => p.total && !p.url.startsWith('tts:') && progress?.(id, p.loaded / p.total) })
    TtsSession._instance = null
    sessions.set(id, s)
    s.catch(() => sessions.delete(id))
  }
  return s
}

/** starts downloading and loading a voice ahead of its first line */
export function piperPrepare(id: string, progress?: DownloadProgress) {
  void session(id, progress).catch(() => {})
}

export async function piperSpeak(text: string, voice: Voice, progress?: DownloadProgress): Promise<Blob> {
  return (await session(voice.id, progress)).predict(text)
}

/** voices per character: same name, same voice; new names take the next voice of their gender */
export function voiceCaster() {
  const given = new Map<string, Voice>()
  const used = { m: 0, f: 0 }
  return (role: Role, who?: string): Voice => {
    if (role === 'narrator') return { id: PIPER_VOICES.narrator, pitch: 1 }
    const key = `${role}:${who ?? ''}`
    let v = given.get(key)
    if (!v) {
      const pool = PIPER_VOICES[role]
      const n = who ? used[role]++ : 0
      v = { id: pool[n % pool.length], pitch: 1 + 0.07 * Math.floor(n / pool.length) * (role === 'f' ? 1 : -0.6) }
      given.set(key, v)
    }
    return v
  }
}
