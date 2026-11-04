// Lettering for translated speech bubbles. Two free comic fonts with Cyrillic ship with the app; a reader
// who owns a typesetter's font (Anime Ace, CC Wild Words with Cyrillic…) can load the file from disk and
// it is kept on this device only, never uploaded or bundled.

export type BubbleFont = 'comic' | 'hand' | 'plain' | 'custom'

export const BUBBLE_FONTS: { id: BubbleFont; label: string; css: string }[] = [
  { id: 'comic', label: 'Комикс', css: '"Comic Relief", "Manrope Variable", system-ui, sans-serif' },
  { id: 'hand', label: 'Рукописный', css: 'Pangolin, "Comic Relief", system-ui, sans-serif' },
  { id: 'plain', label: 'Обычный', css: '"Manrope Variable", system-ui, sans-serif' },
  { id: 'custom', label: 'Свой файл', css: '"Anyflow Bubble", "Comic Relief", system-ui, sans-serif' },
]

const KEY = 'aniplayer-bubble-font'
const NAME_KEY = 'aniplayer-bubble-font-name'

let loaded: Promise<boolean> | null = null

/** registers the reader's own font, if one was saved; resolves to whether there is one */
export function loadCustomFont(): Promise<boolean> {
  loaded ??= (async () => {
    let data: string | null = null
    try {
      data = localStorage.getItem(KEY)
    } catch {
      return false
    }
    if (!data) return false
    try {
      const face = new FontFace('Anyflow Bubble', `url(${data})`)
      await face.load()
      document.fonts.add(face)
      return true
    } catch {
      return false
    }
  })()
  return loaded
}

export const customFontName = () => {
  try {
    return localStorage.getItem(NAME_KEY)
  } catch {
    return null
  }
}

/** keeps a .ttf / .otf / .woff(2) from disk as the bubble font */
export async function saveCustomFont(file: File): Promise<void> {
  if (file.size > 3_000_000) throw new Error('Файл больше 3 МБ — выберите обычный .ttf или .otf шрифта')
  const data = await new Promise<string>((done, fail) => {
    const r = new FileReader()
    r.onload = () => done(String(r.result))
    r.onerror = () => fail(new Error('Не удалось прочитать файл'))
    r.readAsDataURL(file)
  })
  // check it really is a font before keeping it
  const face = new FontFace('Anyflow Bubble', `url(${data})`)
  await face.load().catch(() => {
    throw new Error('Это не похоже на файл шрифта')
  })
  try {
    localStorage.setItem(KEY, data)
    localStorage.setItem(NAME_KEY, file.name.replace(/\.(ttf|otf|woff2?)$/i, ''))
  } catch {
    throw new Error('Не хватает места, чтобы сохранить шрифт')
  }
  for (const f of [...document.fonts]) if (f.family.replace(/"/g, '') === 'Anyflow Bubble') document.fonts.delete(f)
  document.fonts.add(face)
  loaded = Promise.resolve(true)
}

export const fontCss = (id: BubbleFont | undefined) => (BUBBLE_FONTS.find((f) => f.id === id) ?? BUBBLE_FONTS[0]).css
