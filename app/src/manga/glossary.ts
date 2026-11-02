// Names and terms of a title as its translation settled on them: Gemini lists every name, place and
// special term it translated, they are kept per title, and every later page or chapter gets the list,
// so "Rimuru" stays "Римуру" and doesn't turn into "Римуро" three chapters later. The reader can see the
// list and fix any spelling; a fixed one is never overwritten.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Term {
  ru: string
  /** fixed by hand: the translator's own spelling never replaces it */
  mine?: boolean
}

interface GlossaryState {
  lists: Record<string, Record<string, Term>>
  learn: (title: string, names: { original: string; russian: string }[]) => void
  set: (title: string, original: string, ru: string) => void
  remove: (title: string, original: string) => void
}

const LIMIT = 300

export const useGlossary = create<GlossaryState>()(
  persist(
    (set, get) => ({
      lists: {},
      learn: (title, names) => {
        const cur = { ...get().lists[title] }
        let changed = false
        for (const n of names) {
          const o = n.original?.trim()
          const r = n.russian?.trim()
          // only names: short, and actually rendered differently (not "OK" → "OK")
          if (!o || !r || o.length > 40 || r.length > 40 || o === r || cur[o]) continue
          if (Object.keys(cur).length >= LIMIT) break
          cur[o] = { ru: r }
          changed = true
        }
        if (changed) set({ lists: { ...get().lists, [title]: cur } })
      },
      set: (title, original, ru) =>
        set({
          lists: {
            ...get().lists,
            [title]: { ...get().lists[title], [original]: { ru, mine: true } },
          },
        }),
      remove: (title, original) => {
        const { [original]: _, ...rest } = get().lists[title] ?? {}
        set({ lists: { ...get().lists, [title]: rest } })
      },
    }),
    { name: 'aniplayer-glossary' },
  ),
)

/** the part of a translation prompt that keeps names consistent and asks for new ones */
export function glossaryPrompt(title: string | undefined) {
  const list = title ? useGlossary.getState().lists[title] : undefined
  const known = list ? Object.entries(list).map(([o, t]) => `${o} → ${t.ru}`) : []
  return `${known.length ? `Names and terms already settled for this title; always write them exactly like this:\n${known.join('\n')}\n` : ''}In "names", list every character name, place and special term (skill, rank, organisation) in this text with the Russian you used, as {original, russian}.`
}

export const NAMES_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { original: { type: 'STRING' }, russian: { type: 'STRING' } },
    required: ['original', 'russian'],
  },
}
