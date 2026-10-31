// Ranobe translator: a chapter's paragraphs go to Gemini in batches and come back in Russian,
// one paragraph for one paragraph, so the chapter keeps its shape. Finished chapters are kept
// next to the book file, so re-reading costs no quota.
import { askGemini, type GeminiOpts } from './translate'
import { storage } from '../lib/offline'

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd, figcaption, td, th, pre'
const BATCH_CHARS = 4000

const PROMPT = (title: string) => `You are translating the light novel "${title}" into Russian.
You get a JSON array of paragraphs. Return a JSON array of the same length: each paragraph translated
into natural, lively literary Russian, the way a good Russian ranobe fan-translation team would write it.
Keep each character's voice and the anime feel: honorifics (-сан, -кун, -тян, -сэмпай), interjections,
stammering, ellipses and exclamations; jokes, puns and innuendo adapted so they still work; swearing as
strong as the original. Translate everything faithfully, whatever its content. Never merge, split, skip or
reorder paragraphs; an empty paragraph stays empty.`

/** the chapter is mostly Cyrillic already: nothing to translate */
export function isRussian(html: string) {
  const text = html.replace(/<[^>]+>/g, ' ')
  const cyr = (text.match(/[а-яё]/gi) ?? []).length
  const lat = (text.match(/[a-z]/gi) ?? []).length
  const cjk = (text.match(/[぀-ヿ一-鿿가-힯]/g) ?? []).length
  return cyr > (lat + cjk * 3) * 2
}

/** the text blocks of a chapter, innermost only (a <blockquote> holding <p>s is left to its <p>s) */
function blocksOf(doc: Document) {
  return [...doc.body.querySelectorAll<HTMLElement>(BLOCKS)].filter((el) => !el.querySelector(BLOCKS) && el.textContent?.trim())
}

const memory = new Map<string, string>()
const running = new Map<string, Promise<string>>()
const file = (bookId: string, chapter: number) => `book-${bookId}/ru-${chapter}.html`

export async function savedChapter(bookId: string, chapter: number): Promise<string | null> {
  const k = file(bookId, chapter)
  if (memory.has(k)) return memory.get(k)!
  try {
    const html = new TextDecoder().decode(await storage.read(k))
    memory.set(k, html)
    return html
  } catch {
    return null
  }
}

/**
 * The chapter in Russian. `onPart` gets the chapter with every finished batch swapped in, so the
 * reader can show the beginning while the rest is still on its way.
 */
export function translateChapter(
  bookId: string,
  chapter: number,
  html: string,
  ctx: GeminiOpts & { title: string },
  onPart?: (html: string, done: number, total: number) => void,
): Promise<string> {
  const k = file(bookId, chapter)
  if (!running.has(k)) {
    const p = (async () => {
      const hit = await savedChapter(bookId, chapter)
      if (hit) return hit
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
      const els = blocksOf(doc)
      const batches: HTMLElement[][] = []
      let cur: HTMLElement[] = []
      let size = 0
      for (const el of els) {
        const n = el.textContent!.length
        if (cur.length && size + n > BATCH_CHARS) {
          batches.push(cur)
          cur = []
          size = 0
        }
        cur.push(el)
        size += n
      }
      if (cur.length) batches.push(cur)
      for (const [i, batch] of batches.entries()) {
        const ru = await translateBatch(
          batch.map((el) => el.textContent!.replace(/\s+/g, ' ').trim()),
          ctx,
        )
        // the text replaces the paragraph's own text; pictures inside it stay
        batch.forEach((el, j) => {
          const imgs = [...el.querySelectorAll('img, svg')]
          el.textContent = ru[j] ?? el.textContent
          imgs.forEach((img) => el.prepend(img))
        })
        onPart?.(doc.body.innerHTML, i + 1, batches.length)
      }
      const out = doc.body.innerHTML
      memory.set(k, out)
      void storage.write(k, out).catch(() => {})
      return out
    })()
    running.set(k, p)
    p.catch(() => {}).finally(() => running.delete(k))
  }
  return running.get(k)!
}

async function translateBatch(paras: string[], ctx: GeminiOpts & { title: string }) {
  const json = await askGemini(
    {
      contents: [{ parts: [{ text: `${PROMPT(ctx.title)}\n\n${JSON.stringify(paras)}` }] }],
      safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({
        category,
        threshold: 'BLOCK_NONE',
      })),
      generationConfig: { temperature: 0.5, responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'STRING' } } },
    },
    ctx,
  )
  const text: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error(json?.promptFeedback?.blockReason ? 'Gemini отказался переводить эту главу' : 'Пустой ответ Gemini')
  const out = JSON.parse(text) as string[]
  if (!Array.isArray(out)) throw new Error('Gemini вернул перевод в неожиданном виде')
  return out
}
