// The old Firebase account, read once when its owner signs in to the new server: everything it holds
// comes along, then Firebase is never touched again. Loaded only for that moment.
import type { Progress, TitleEntry, SyncedPrefs } from './store'
import type { MangaEntry } from '../manga/store'
import { firebaseConfig } from '../firebase-config'

export interface LegacyData {
  progress: Progress[]
  titles: TitleEntry[]
  manga: MangaEntry[]
  prefs: SyncedPrefs | null
  stats: Record<string, number>
}

/** null when Firebase knows no such login and password */
export async function readLegacyAccount(email: string, password: string): Promise<LegacyData | null> {
  if (!firebaseConfig?.apiKey) return null
  const [{ initializeApp, deleteApp }, { getAuth, signInWithEmailAndPassword, signOut, inMemoryPersistence, setPersistence }, fs] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ])
  const app = initializeApp(firebaseConfig, `legacy-${Date.now()}`)
  try {
    const auth = getAuth(app)
    await setPersistence(auth, inMemoryPersistence)
    let uid: string
    try {
      uid = (await signInWithEmailAndPassword(auth, email, password)).user.uid
    } catch {
      return null
    }
    const db = fs.getFirestore(app)
    const all = async <T,>(name: string) => (await fs.getDocs(fs.collection(db, 'users', uid, name))).docs.map((d) => d.data() as T)
    const one = async <T,>(name: string) => ((await fs.getDoc(fs.doc(db, 'users', uid, 'meta', name))).data() as T | undefined) ?? null
    const [progress, titles, manga, prefs, stats] = await Promise.all([
      all<Progress>('progress'),
      all<TitleEntry>('titles'),
      all<MangaEntry>('manga'),
      one<SyncedPrefs>('prefs'),
      one<Record<string, number>>('stats'),
    ])
    await signOut(auth)
    return { progress, titles, manga, prefs, stats: stats ?? {} }
  } finally {
    void deleteApp(app)
  }
}
