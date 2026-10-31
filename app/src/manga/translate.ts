// Page translator: Gemini looks at the whole page, finds every speech bubble and caption,
// reads it and translates it into Russian with the scene in mind (who speaks, puns, tone).
// Uses the reader's own free Google AI Studio key; nothing goes through our servers.

export interface Bubble {
  /** position on the page as fractions of its width / height */
  x: number
  y: number
  w: number
  h: number
  text: string
  ru: string
}

const API = 'https://generativelanguage.googleapis.com/v1beta/models'
export const KEY_URL = 'https://aistudio.google.com/apikey'

// what free keys can use (late 2026); older names are gone for new users
export const MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash — переводит лучше; если занята, сам перейдёт на Flash-Lite' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite — быстро, пара секунд на страницу' },
]
export const DEFAULT_MODEL = MODELS[0].id

// results survive restarts, so a re-read chapter costs no quota
const STORE = 'aniplayer-translations'
const MAX_SAVED = 600
let saved: Record<string, { at: number; b: Bubble[] }> = {}
try {
  saved = JSON.parse(localStorage.getItem(STORE) ?? '{}')
} catch {
  saved = {}
}
function remember(key: string, b: Bubble[]) {
  saved[key] = { at: Date.now(), b }
  const keys = Object.keys(saved)
  if (keys.length > MAX_SAVED) keys.sort((a, c) => saved[a].at - saved[c].at).slice(0, keys.length - MAX_SAVED).forEach((k) => delete saved[k])
  try {
    localStorage.setItem(STORE, JSON.stringify(saved))
  } catch {
    /* storage full: keep it in memory */
  }
}

export const savedTranslation = (url: string) => saved[url]?.b ?? null

// one page at a time keeps us inside the free tier's per-minute limit. The page asked for last goes
// first: the reader asks for the far pages before the current one, so after a page turn the page
// on screen jumps ahead of the ones queued in advance
interface Job {
  url: string
  ctx: PageContext
  rank: number
  done: (b: Bubble[]) => void
  fail: (e: unknown) => void
}
const waiting = new Map<string, Job>()
const running = new Map<string, Promise<Bubble[]>>()
let asked = 0
let busy = false

async function work() {
  if (busy) return
  busy = true
  while (waiting.size) {
    const job = [...waiting.values()].reduce((a, b) => (b.rank > a.rank ? b : a))
    waiting.delete(job.url)
    try {
      job.done(await run(job.url, job.ctx))
    } catch (e) {
      job.fail(e)
    }
  }
  busy = false
}

export interface PageContext extends GeminiOpts {
  title: string
  /** another copy of the page (MangaDex's own server) to try when the first one won't load */
  alt?: string
}

export function translatePage(url: string, ctx: PageContext): Promise<Bubble[]> {
  const hit = savedTranslation(url)
  if (hit) return Promise.resolve(hit)
  const job = waiting.get(url)
  if (job) job.rank = ++asked
  if (!running.has(url)) {
    const p = new Promise<Bubble[]>((done, fail) => waiting.set(url, { url, ctx, rank: ++asked, done, fail }))
    p.then((b) => remember(url, b))
      .catch(() => {})
      .finally(() => running.delete(url))
    running.set(url, p)
    void work()
  }
  return running.get(url)!
}

/** the page as a JPEG no larger than Gemini needs */
/** the page's bytes, fetched fresh: the copy the reader already shows was cached without CORS
 *  permission, and reusing it for pixel access fails with "Failed to fetch" */
async function download(url: string, alt?: string): Promise<Blob> {
  const bridge = window.aniplayer?.fetchImage
  for (const u of alt && alt !== url ? [url, alt] : [url]) {
    // Windows app: the main process fetches it, no CORS in the way
    if (bridge) {
      try {
        return new Blob([(await bridge(u)) as Uint8Array<ArrayBuffer>])
      } catch {
        /* fall back to fetch below */
      }
    }
    for (const v of [u, `${u}${u.includes('?') ? '&' : '?'}tr=1`]) {
      try {
        const res = await fetch(v, { cache: 'no-store', mode: 'cors' })
        if (res.ok) return await res.blob()
      } catch {
        /* try the next way */
      }
    }
  }
  throw new Error('Не удалось загрузить страницу для перевода')
}

async function pageImage(url: string, alt?: string) {
  const bmp = await createImageBitmap(await download(url, alt))
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c.toDataURL('image/jpeg', 0.88).split(',')[1]
}

const PROMPT = (title: string) => `You are a professional manga translator working on "${title}".
Find EVERY piece of text on this page: speech bubbles, thought bubbles, narration boxes, signs and handwritten notes.
For each one give its box and translate it into natural, lively Russian the way a good Russian anime/manga fan-sub team would:
keep each character's voice, jokes, puns and double meanings (adapt wordplay so it still works in Russian),
honorifics like -san/-kun/-chan/-senpai/-sama written the way Russian fansubs do (Сато-сан, сэмпай), names in their usual Russian spelling,
and swearing or innuendo exactly as strong as the original.
Keep the anime feel: emotional exclamations and interjections (Э?!, А-а-а!, Ня, Хм...), stretched words, stammering,
ellipses and "!?" as in the original; cute speech stays cute, a tsundere stays tsundere, a narrator stays dramatic.
Sound natural and short enough to fit the bubble, never stiff or bookish.
Translate everything faithfully, whatever its content. Skip sound effects drawn as part of the art and scanlator credits.
box_2d is [ymin, xmin, ymax, xmax] normalized to 0-1000, covering the whole bubble or text area.
Return them in reading order.`

const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({
  category,
  threshold: 'BLOCK_NONE',
}))

// A model that just failed sits out a while so pages don't each wait for its timeout;
// a key that ran out of free requests (per model) rests until it likely refills
const resting = new Map<string, number>()
const rest = (id: string, ms: number) => resting.set(id, Date.now() + ms)
const ready = (id: string) => (resting.get(id) ?? 0) < Date.now()

export interface GeminiOpts {
  /** the reader's keys: when one runs out of free requests the next one takes over */
  keys: string[]
  model: string
}

/** one generateContent call: the chosen model first with every key, then the other models */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function askGemini(body: object, { keys, model }: GeminiOpts): Promise<any> {
  const allKeys = [...new Set(keys.map((k) => k.trim()).filter(Boolean))]
  if (!allKeys.length) throw new Error('Нет ключа Gemini — добавьте его в настройках переводчика')
  const allModels = [...new Set([model, ...MODELS.map((m) => m.id)])]
  const models = allModels.filter(ready).length ? allModels.filter(ready) : allModels
  let res: Response | null = null
  let json: any = null // eslint-disable-line @typescript-eslint/no-explicit-any
  let badKey = false
  for (const m of models) {
    const fresh = allKeys.filter((k) => ready(`${k}|${m}`) && ready(k))
    for (const key of fresh.length ? fresh : allKeys) {
      try {
        res = await fetch(`${API}/${m}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          // an overloaded model can take minutes; better to ask the next one
          signal: AbortSignal.timeout(45_000),
        })
      } catch {
        rest(m, 2 * 60_000)
        res = null
        break // the model (or the network) is the problem, not the key
      }
      json = await res.json().catch(() => null)
      if (res.ok) return json
      const msg: string = json?.error?.message ?? ''
      if (res.status === 400 && /API key/i.test(msg)) {
        badKey = true
        rest(key, 60 * 60_000)
        continue
      }
      if (res.status === 429 || res.status === 403) {
        // this key's quota for this model is spent (or the model is closed to it): try the next key
        rest(`${key}|${m}`, res.status === 429 ? 30 * 60_000 : 60 * 60_000)
        continue
      }
      if (res.status === 500 || res.status === 503 || res.status === 404) {
        rest(m, res.status === 404 ? 24 * 3600_000 : 2 * 60_000)
        break // overloaded or gone for everyone: next model
      }
      break
    }
    if (res && ![400, 403, 404, 429, 500, 503].includes(res.status)) break
  }
  if (!res) throw new Error('Нет связи с Gemini — проверьте интернет (или включите VPN, если Gemini недоступен в вашей стране)')
  const msg: string = json?.error?.message ?? `HTTP ${res.status}`
  if (res.status === 429)
    throw new Error(allKeys.length > 1 ? 'Лимит бесплатных запросов исчерпан на всех ключах — подождите минуту или до завтра' : 'Лимит бесплатных запросов Gemini исчерпан — подождите, или добавьте ещё ключ')
  if (badKey && res.status === 400) throw new Error('Ключ Gemini не подходит — проверьте его в настройках переводчика')
  throw new Error(msg)
}

async function run(url: string, ctx: PageContext): Promise<Bubble[]> {
  const image = await pageImage(url, ctx.alt)
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }, { text: PROMPT(ctx.title) }] }],
    safetySettings: SAFETY,
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
            text: { type: 'STRING' },
            ru: { type: 'STRING' },
          },
          required: ['box_2d', 'text', 'ru'],
        },
      },
    },
  }
  const json = await askGemini(body, ctx)
  const text: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error(json?.promptFeedback?.blockReason ? 'Gemini отказался переводить эту страницу' : 'Пустой ответ Gemini')
  const items = JSON.parse(text) as { box_2d: number[]; text: string; ru: string }[]
  return items
    .filter((i) => i.box_2d?.length === 4 && i.ru?.trim())
    .map((i) => {
      const [y0, x0, y1, x1] = i.box_2d.map((v) => Math.max(0, Math.min(1000, v)) / 1000)
      return { x: x0, y: y0, w: Math.max(0.02, x1 - x0), h: Math.max(0.015, y1 - y0), text: i.text, ru: i.ru.trim() }
    })
}
