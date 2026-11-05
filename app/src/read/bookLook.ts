// How a book's text looks: the typefaces a reader can pick and the space around the text on a page.
import '@fontsource-variable/literata'
import '@fontsource-variable/lora'
import '@fontsource/pt-serif/400.css'
import '@fontsource/pt-serif/400-italic.css'
import '@fontsource/pt-serif/700.css'

export const FONTS = {
  literata: { css: '"Literata Variable", Georgia, serif', label: 'Literata', hint: 'шрифт для чтения книг с экрана' },
  pt: { css: '"PT Serif", Georgia, serif', label: 'PT Serif', hint: 'как в русских изданиях' },
  lora: { css: '"Lora Variable", Georgia, serif', label: 'Lora', hint: 'мягкий, с характером' },
  serif: { css: 'Georgia, "Times New Roman", serif', label: 'Georgia', hint: 'классика' },
  sans: { css: '"Manrope Variable", system-ui, sans-serif', label: 'Без засечек', hint: 'современный' },
  mono: { css: 'ui-monospace, "Cascadia Mono", Consolas, monospace', label: 'Моно', hint: 'пишущая машинка' },
} as const

export type BookFont = keyof typeof FONTS

/** the text's inner margins on a page, as a share of the page's width (with a floor in pixels) */
export const MARGINS = {
  narrow: { k: 0.05, min: 16, label: 'Узкие' },
  normal: { k: 0.085, min: 22, label: 'Обычные' },
  wide: { k: 0.13, min: 30, label: 'Широкие' },
} as const

/** the text's colour softened towards the paper, for a gentler contrast */
export const softFg = (fg: string, bg: string) => `color-mix(in srgb, ${fg} 82%, ${bg})`
