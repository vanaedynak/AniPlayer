// Splits a chapter into lines for reading aloud and guesses who speaks each one. Russian gives it
// away for free: the past tense carries gender ("— Беги! — крикнула она", "сказал Шин").

export type Gender = 'm' | 'f'
export type Role = 'narrator' | 'm' | 'f'

export interface Line {
  /** index of the paragraph element it came from, for highlighting */
  block: number
  text: string
  role: Role
  /** who speaks, when the remark names them: same name, same voice */
  who?: string
}

const DASH = /^\s*[—–-]\s*/
// a remark after a reply: "…, — сказала она. — …" splits into reply / remark / reply
const SPLIT = /([,.!?…])\s+[—–]\s+/

// past tense: ...ла / ...лась is her, ...л / ...лся is him; short words like "пол", "стол" are not verbs
const FEM = /(?:^|[\s,])([а-яё]{2,}(?:ла|лась))(?=[\s,.!?…]|$)/i
const MASC = /(?:^|[\s,])([а-яё]{2,}(?:л|лся))(?=[\s,.!?…]|$)/i
const NOT_VERB = /^(?:стол|пол|зал|бал|вол|дол|кол|мол|пул|угол|орёл|осёл|котёл|ствол|посол|пепел|пепла|мысль|сила|мила|пила|жила|бела|скала|стрела|игла|земля|мгла|метла|пчела|смола|юла|была)$/i
const NAME = /(?<![А-ЯЁа-яё])([А-ЯЁ][а-яё]+(?:[- ][А-ЯЁ][а-яё]+)?)(?![А-ЯЁа-яё])/g
// words that start a sentence or are pronouns, never a name
const NOT_NAME = new Set('Он Она Они Я Мы Ты Вы Его Её Ее Это Но И А Так Тот Та Там Тут Что Как Когда Где Его Ей Им Ему Затем Потом Тогда Вдруг Да Нет Ну Ох Ах Эй'.split(' '))

function genderOf(remark: string): Gender | null {
  const words = remark.split(/(?=[\s,])/)
  for (const w of words) {
    const f = w.match(FEM)
    if (f && !NOT_VERB.test(f[1])) return 'f'
    const m = w.match(MASC)
    if (m && !NOT_VERB.test(m[1])) return 'm'
  }
  if (/(?:^|\s)она(?:[\s,.]|$)/i.test(remark)) return 'f'
  if (/(?:^|\s)он(?:[\s,.]|$)/i.test(remark)) return 'm'
  return null
}

function nameIn(remark: string): string | undefined {
  // only near the verb: "сказала Маша", "Маша кивнула", not someone mentioned later in the sentence
  const head = remark.split(/[.!?…]/)[0].split(' ').slice(0, 5).join(' ')
  for (const m of head.matchAll(NAME)) if (!NOT_NAME.has(m[1].split(/[- ]/)[0])) return m[1]
  return undefined
}

/** the paragraph-like elements of a chapter, in reading order */
export function blocksOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, pre')].filter(
    (el) => !el.querySelector('p, li, blockquote') && el.textContent?.trim(),
  )
}

export function linesOf(blocks: string[]): Line[] {
  const genders = new Map<string, Gender>()
  const out: Line[] = []
  // the last two speakers, for replies nobody attributes (a dialogue goes back and forth)
  let last: { role: Gender; who?: string } | null = null
  let before: { role: Gender; who?: string } | null = null

  blocks.forEach((raw, block) => {
    const text = raw.replace(/\s+/g, ' ').trim()
    if (!text) return
    const dialogue = DASH.test(text) || /^«/.test(text)
    if (!dialogue) {
      out.push({ block, text, role: 'narrator' })
      return
    }
    // «Реплика», — сказала она.  becomes  — Реплика, — сказала она.
    const body = text.replace(/^«([^»]+)»\s*/, '$1').replace(DASH, '')
    const parts = body.split(SPLIT)
    // parts: reply, punct, remark, punct, reply, ...
    const pieces: { text: string; speech: boolean }[] = []
    for (let i = 0, speech = true; i < parts.length; i += 2, speech = !speech) {
      const t = (parts[i] + (parts[i + 1] ?? '')).trim()
      if (t) pieces.push({ text: t, speech })
    }
    const remarks = pieces.filter((p) => !p.speech).map((p) => p.text).join(' ')
    let who = remarks ? nameIn(remarks) : undefined
    let g = remarks ? genderOf(remarks) : null
    if (who && g) genders.set(who, g)
    if (who && !g) g = genders.get(who) ?? null
    // "фыркнула она": the last one of that gender who spoke
    if (g && !who) who = [last, before].find((x) => x?.role === g)?.who
    if (!g) {
      // nobody named: the other one of the last two speakers answers; after the first named reply
      // that is someone new
      const other = before ?? (last ? { role: 'm' as Gender, who: last.role === 'm' ? `${last.who ?? ''}#2` : undefined } : null)
      g = other?.role ?? 'm'
      who = other?.who
    }
    for (const p of pieces) out.push({ block, text: p.text, role: p.speech ? g : 'narrator', who: p.speech ? who : undefined })
    if (!last || last.role !== g || last.who !== who) {
      before = last
      last = { role: g, who }
    }
  })
  return out
}
