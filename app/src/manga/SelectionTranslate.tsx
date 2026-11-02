import { useEffect, useRef, useState, type RefObject } from 'react'
import { Copy, Languages, Loader2, Volume2, X } from 'lucide-react'
import { askGemini, DEFAULT_MODEL } from './translate'

interface Result {
  translation: string
  transcription?: string
  pos?: string
  meanings?: string[]
  note?: string
}

const cache = new Map<string, Promise<Result>>()

/** the language of a piece of text, near enough for a translator and a voice */
function langOf(text: string) {
  if (/[぀-ヿ]/.test(text)) return { code: 'ja', voice: 'ja-JP' }
  if (/[가-힯]/.test(text)) return { code: 'ko', voice: 'ko-KR' }
  if (/[一-鿿]/.test(text)) return { code: 'zh', voice: 'zh-CN' }
  return { code: 'en', voice: 'en-US' }
}

const isWord = (t: string) => !/\s/.test(t.trim()) || t.trim().split(/\s+/).length <= 3

async function viaGemini(text: string, context: string, title: string, keys: string[], model: string): Promise<Result> {
  const word = isWord(text)
  const prompt = `You help a Russian reader who is reading the novel "${title}" in the original.
Selected text: ${JSON.stringify(text)}
The sentence it is in: ${JSON.stringify(context.slice(0, 1200))}
Translate the selected text into natural Russian as it is meant in this sentence ("translation").${
    word
      ? ` It is a word or a short expression: also give its transcription in IPA ("transcription"), its part of speech in Russian ("pos"),
up to three of its common Russian meanings ("meanings"), and, if it is an idiom, slang or a pun, one short line in Russian about it ("note").`
      : ' If there is an idiom, slang or a pun in it, add one short line in Russian about it ("note").'
  }`
  const json = await askGemini(
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            translation: { type: 'STRING' },
            transcription: { type: 'STRING' },
            pos: { type: 'STRING' },
            meanings: { type: 'ARRAY', items: { type: 'STRING' } },
            note: { type: 'STRING' },
          },
          required: ['translation'],
        },
      },
    },
    { keys, model },
  )
  const out = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  if (!out) throw new Error('Пустой ответ Gemini')
  return JSON.parse(out) as Result
}

/** MyMemory: a free public translation service, for readers without a Gemini key */
async function viaMyMemory(text: string): Promise<Result> {
  const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 450))}&langpair=${langOf(text).code}|ru`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = await res.json()
  const t: string = j?.responseData?.translatedText ?? ''
  if (!t || j?.responseStatus >= 400) throw new Error(j?.responseDetails || 'Переводчик не ответил')
  return { translation: t }
}

/**
 * Select a word or a phrase in the text (a long press on the iPad, a double click or a drag on the PC)
 * and its translation shows up under it: in the sense of that very sentence, with the transcription and
 * other meanings for a single word. Gemini when there is a key, a free translator otherwise.
 */
export function SelectionTranslate({
  root,
  enabled,
  title,
  keys,
  model,
}: {
  /** the element holding the text */
  root: RefObject<HTMLElement | null>
  enabled: boolean
  title: string
  keys: string[]
  model: string
}) {
  const [sel, setSel] = useState<{
    text: string
    context: string
    x: number
    top: number
    bottom: number
  } | null>(null)
  const [res, setRes] = useState<Result | null>(null)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(0)

  useEffect(() => {
    if (!enabled) return setSel(null)
    let t: ReturnType<typeof setTimeout>
    const read = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        const s = window.getSelection()
        const text = s?.toString().replace(/\s+/g, ' ').trim() ?? ''
        if (!s || s.isCollapsed || !text || text.length > 500 || !root.current?.contains(s.anchorNode)) {
          // a tap on the popup itself leaves the selection alone
          if (!box.current?.matches(':hover')) setSel(null)
          return
        }
        const r = s.getRangeAt(0).getBoundingClientRect()
        const block = (s.anchorNode?.parentElement?.closest('p, li, blockquote, h1, h2, h3, h4, dd, div') as HTMLElement | null)?.textContent ?? text
        setSel((cur) =>
          cur?.text === text
            ? cur
            : {
                text,
                context: block,
                x: r.left + r.width / 2,
                top: r.top,
                bottom: r.bottom,
              },
        )
      }, 400)
    }
    document.addEventListener('selectionchange', read)
    return () => {
      clearTimeout(t)
      document.removeEventListener('selectionchange', read)
    }
  }, [enabled, root])

  useEffect(() => {
    if (!sel) return
    let alive = true
    setRes(null)
    setErr('')
    const hasKey = keys.some((k) => k.trim())
    const k = `${hasKey ? 'g' : 'm'}|${sel.text}|${sel.context.slice(0, 200)}`
    let p = cache.get(k)
    if (!p) {
      p = hasKey ? viaGemini(sel.text, sel.context, title, keys, model || DEFAULT_MODEL).catch(() => viaMyMemory(sel.text)) : viaMyMemory(sel.text)
      cache.set(k, p)
      p.catch(() => cache.delete(k))
    }
    p.then((r) => alive && setRes(r)).catch((e) => alive && setErr(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [sel, keys, model, title])

  useEffect(() => {
    if (box.current) setH(box.current.offsetHeight)
  }, [res, err, sel])

  if (!sel) return null
  const w = Math.min(360, window.innerWidth - 24)
  const left = Math.max(12, Math.min(window.innerWidth - w - 12, sel.x - w / 2))
  // under the selection (the iPad puts its own menu above it), above when there is no room below
  const below = sel.bottom + 14 + (h || 160) < window.innerHeight - 20
  const top = below ? sel.bottom + 14 : Math.max(12, sel.top - 14 - (h || 160))
  const speak = () => {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(sel.text)
    u.lang = langOf(sel.text).voice
    u.rate = 0.9
    speechSynthesis.speak(u)
  }

  return (
    <div
      ref={box}
      className="animate-pop fixed z-[80] flex flex-col gap-2 rounded-2xl bg-card/95 p-4 text-left text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
      style={{
        left,
        top,
        width: w,
        fontFamily: '"Manrope Variable", system-ui, sans-serif',
      }}
      // keep the selection: a tap here must not clear it
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-bold text-white/60">{sel.text}</div>
          {res?.transcription && <div className="text-xs text-white/40">[{res.transcription.replace(/^\[|\]$|^\/|\/$/g, '')}]</div>}
        </div>
        <button onClick={speak} title="Произнести" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
          <Volume2 size={16} />
        </button>
        <button
          onClick={() => void navigator.clipboard?.writeText(res ? `${sel.text} — ${res.translation}` : sel.text).catch(() => {})}
          title="Скопировать"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
        >
          <Copy size={15} />
        </button>
        <button
          onClick={() => {
            window.getSelection()?.removeAllRanges()
            setSel(null)
          }}
          title="Закрыть"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
        >
          <X size={16} />
        </button>
      </div>
      {err ? (
        <div className="text-sm text-rose-300">Не получилось перевести: {err}</div>
      ) : !res ? (
        <div className="flex items-center gap-2 text-sm text-white/60">
          <Loader2 size={15} className="animate-spin" /> Перевожу…
        </div>
      ) : (
        <>
          <div className="text-base leading-snug font-extrabold">{res.translation}</div>
          {(res.pos || res.meanings?.length) && (
            <div className="text-sm text-white/70">
              {res.pos && <span className="mr-1.5 italic text-white/45">{res.pos}</span>}
              {res.meanings?.filter((m) => m && m !== res.translation).join(', ')}
            </div>
          )}
          {res.note && <div className="rounded-xl bg-white/5 px-3 py-2 text-xs leading-relaxed text-white/70">{res.note}</div>}
          {!keys.some((k) => k.trim()) && (
            <div className="flex items-center gap-1.5 text-[11px] text-white/35">
              <Languages size={12} /> С ключом Gemini перевод учитывает смысл предложения
            </div>
          )}
        </>
      )}
    </div>
  )
}
