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
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite — быстро, пара секунд на страницу' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash — чуть точнее, но часто перегружена' },
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

// one page at a time keeps us inside the free tier's per-minute limit
let queue: Promise<unknown> = Promise.resolve()
const running = new Map<string, Promise<Bubble[]>>()

export interface PageContext {
  key: string
  model: string
  title: string
}

export function translatePage(url: string, ctx: PageContext): Promise<Bubble[]> {
  const hit = savedTranslation(url)
  if (hit) return Promise.resolve(hit)
  if (!running.has(url)) {
    const p = (queue = queue.catch(() => {}).then(() => run(url, ctx))) as Promise<Bubble[]>
    p.then((b) => remember(url, b)).finally(() => running.delete(url))
    running.set(url, p)
  }
  return running.get(url)!
}

/** the page as a JPEG no larger than Gemini needs */
async function pageImage(url: string) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob())
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
For each one give its box and translate it into natural, lively Russian as a skilled fan translator would:
keep each character's voice, jokes, puns and double meanings (adapt wordplay so it still works in Russian),
honorifics like -san/-kun/-sama, names in their usual Russian spelling, and swearing or innuendo exactly as strong as the original.
Translate everything faithfully, whatever its content. Skip sound effects drawn as part of the art and scanlator credits.
box_2d is [ymin, xmin, ymax, xmax] normalized to 0-1000, covering the whole bubble or text area.
Return them in reading order.`

const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({
  category,
  threshold: 'BLOCK_NONE',
}))

async function run(url: string, ctx: PageContext): Promise<Bubble[]> {
  const image = await pageImage(url)
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
  // the chosen model first; when it's overloaded or closed to free keys, the next one
  const models = [...new Set([ctx.model, ...MODELS.map((m) => m.id)])]
  let res: Response | null = null
  let json: any = null // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const model of models) {
    try {
      res = await fetch(`${API}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ctx.key },
        body: JSON.stringify(body),
        // an overloaded model can take minutes; better to ask the next one
        signal: AbortSignal.timeout(45_000),
      })
    } catch {
      continue
    }
    json = await res.json().catch(() => null)
    if (![403, 404, 429, 500, 503].includes(res.status)) break
  }
  if (!res) throw new Error('Нет ответа Gemini')
  if (!res.ok) {
    const msg: string = json?.error?.message ?? `HTTP ${res.status}`
    if (res.status === 429) throw new Error('Лимит бесплатных запросов Gemini исчерпан — подождите минуту или до завтра')
    if (res.status === 400 && /API key/i.test(msg)) throw new Error('Ключ Gemini не подходит — проверьте его в настройках чтения')
    throw new Error(msg)
  }
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
