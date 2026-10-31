// Logins and keys kept in the device's own encrypted storage, outside the app's data: on the iPad that is
// the Keychain, which iOS keeps when the app is deleted, so a reinstall from a new IPA signs back in by itself.
// On Android it survives updates (installing a new APK over the old one), not uninstalling.
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { isNative } from './platform'
import { useStore } from './store'
import { useManga } from '../manga/store'

interface Vault {
  login?: string
  password?: string
  geminiKeys?: string[]
  geminiModel?: string
  anilistToken?: string
  anilistClient?: string
  firebaseConfig?: string
}

const KEY = 'aniplayer-vault'
const FIREBASE = 'aniplayer-firebase-config'
const ANILIST_CLIENT = 'aniplayer-anilist-client'

let saved: Vault = {}

async function write(patch: Partial<Vault>) {
  saved = { ...saved, ...patch }
  for (const k of Object.keys(saved) as (keyof Vault)[]) if (saved[k] === undefined) delete saved[k]
  try {
    await SecureStorage.set(KEY, JSON.stringify(saved))
  } catch (e) {
    console.warn('[vault]', e)
  }
}

/** what a fresh install lacks comes back from the vault; after that every change goes into it */
export async function initVault() {
  if (!isNative) return
  try {
    const raw = await SecureStorage.get(KEY, false)
    saved = typeof raw === 'string' ? JSON.parse(raw) : {}
  } catch {
    saved = {}
  }

  const manga = useManga.getState()
  if (saved.geminiKeys?.some((k) => k.trim()) && !manga.prefs.geminiKeys.some((k) => k.trim()))
    manga.setPrefs({ geminiKeys: saved.geminiKeys, ...(saved.geminiModel ? { geminiModel: saved.geminiModel } : {}) })
  if (saved.anilistToken && !useStore.getState().prefs.anilistToken) useStore.getState().setPrefs({ anilistToken: saved.anilistToken })
  try {
    if (saved.firebaseConfig && !localStorage.getItem(FIREBASE)) localStorage.setItem(FIREBASE, saved.firebaseConfig)
    if (saved.anilistClient && !localStorage.getItem(ANILIST_CLIENT)) localStorage.setItem(ANILIST_CLIENT, saved.anilistClient)
  } catch {
    /* ignore */
  }

  // keep the vault up to date from here on
  const fromApp = (): Partial<Vault> => ({
    geminiKeys: useManga.getState().prefs.geminiKeys.filter((k) => k.trim()),
    geminiModel: useManga.getState().prefs.geminiModel || undefined,
    anilistToken: useStore.getState().prefs.anilistToken || undefined,
    firebaseConfig: localStorage.getItem(FIREBASE) ?? undefined,
    anilistClient: localStorage.getItem(ANILIST_CLIENT) ?? undefined,
  })
  let last = ''
  const sync = () => {
    const now = fromApp()
    const s = JSON.stringify(now)
    if (s === last) return
    last = s
    void write(now)
  }
  useManga.subscribe(sync)
  useStore.subscribe(sync)
  window.addEventListener('storage', sync)
  setInterval(sync, 5000) // localStorage writes in this same window fire no event
  sync()
}

/** the account to sign back in with after a reinstall */
export const vaultLogin = () => (saved.login && saved.password ? { login: saved.login, password: saved.password } : null)

export function vaultRemember(login: string, password: string) {
  if (isNative) void write({ login, password })
}

export function vaultForget() {
  if (isNative) void write({ login: undefined, password: undefined })
}
