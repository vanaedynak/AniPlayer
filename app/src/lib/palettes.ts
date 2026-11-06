// Color themes of the app. Every theme is dark (the interface draws white text everywhere), and differs in
// the tint of the background, the main accent, the second accent and the glow behind the page.
// Applied as CSS variables on <html>, which every Tailwind color in the app reads.
import { achievementById, type Stats } from './achievements'
// original illustrations for the unique themes (generated for Anyflow; no characters or logos from the series)
import scoutsArt from '../assets/theme-art/scouts.webp'
import leafArt from '../assets/theme-art/leaf.webp'
import shinigamiArt from '../assets/theme-art/shinigami.webp'
import slayerArt from '../assets/theme-art/slayer.webp'
import cursedArt from '../assets/theme-art/cursed.webp'
import isekaiArt from '../assets/theme-art/isekai.webp'
import grandlineArt from '../assets/theme-art/grandline.webp'
import eightySixArt from '../assets/theme-art/eightysix.webp'

export interface Palette {
  id: string
  label: string
  group: 'Фирменные' | 'Природа' | 'Аниме-вайб' | 'Строгие' | 'Уникальные'
  bg: string
  card: string
  muted: string
  /** buttons and active elements: dark enough for white text on it */
  accent: string
  /** highlights and accent text: bright enough to read on the background */
  light: string
  /** the second color of gradients and badges */
  pink: string
  /** unique themes: an illustration behind the page (bundled image) */
  art?: string
  /** a faint ornament over the page (unique themes), with its tile size */
  pattern?: string
  patternSize?: string
  /** unique themes open with an achievement (its id in lib/achievements) */
  unlock?: string
}

export const PALETTES: Palette[] = [
  {
    id: 'anyflow',
    label: 'Anyflow',
    group: 'Фирменные',
    bg: '#060a0f',
    card: '#0f161d',
    muted: '#93a3ae',
    accent: '#14b8a6',
    light: '#5eead4',
    pink: '#fb7185',
  },
  {
    id: 'violet',
    label: 'Фиолетовая',
    group: 'Фирменные',
    bg: '#09090d',
    card: '#15151d',
    muted: '#9b9bab',
    accent: '#8b5cf6',
    light: '#a78bfa',
    pink: '#ec4899',
  },
  {
    id: 'cosmos',
    label: 'Космос',
    group: 'Фирменные',
    bg: '#05060f',
    card: '#0e1020',
    muted: '#9497b8',
    accent: '#6366f1',
    light: '#a5b4fc',
    pink: '#f472b6',
  },
  {
    id: 'amoled',
    label: 'AMOLED',
    group: 'Фирменные',
    bg: '#000000',
    card: '#0c0c0e',
    muted: '#9a9aa2',
    accent: '#7c3aed',
    light: '#c4b5fd',
    pink: '#22d3ee',
  },

  {
    id: 'sakura',
    label: 'Сакура',
    group: 'Природа',
    bg: '#100a0d',
    card: '#1c1218',
    muted: '#b39aa6',
    accent: '#db2777',
    light: '#f9a8d4',
    pink: '#c4b5fd',
  },
  {
    id: 'ocean',
    label: 'Океан',
    group: 'Природа',
    bg: '#040b14',
    card: '#0b1626',
    muted: '#8ea3bd',
    accent: '#2563eb',
    light: '#93c5fd',
    pink: '#22d3ee',
  },
  {
    id: 'forest',
    label: 'Лес',
    group: 'Природа',
    bg: '#060d08',
    card: '#0e1a11',
    muted: '#91a796',
    accent: '#16a34a',
    light: '#86efac',
    pink: '#facc15',
  },
  {
    id: 'sunset',
    label: 'Закат',
    group: 'Природа',
    bg: '#100906',
    card: '#1d120c',
    muted: '#b6a090',
    accent: '#ea580c',
    light: '#fdba74',
    pink: '#f43f5e',
  },
  {
    id: 'aurora',
    label: 'Северное сияние',
    group: 'Природа',
    bg: '#041012',
    card: '#0a1c1f',
    muted: '#8daaa9',
    accent: '#059669',
    light: '#6ee7b7',
    pink: '#a78bfa',
  },
  {
    id: 'arctic',
    label: 'Арктика',
    group: 'Природа',
    bg: '#060b10',
    card: '#0e1720',
    muted: '#9aaabb',
    accent: '#0284c7',
    light: '#7dd3fc',
    pink: '#a5b4fc',
  },
  {
    id: 'coffee',
    label: 'Кофе',
    group: 'Природа',
    bg: '#0f0b08',
    card: '#1b1510',
    muted: '#ad9d8c',
    accent: '#b45309',
    light: '#e7c3a0',
    pink: '#f59e0b',
  },

  {
    id: 'synthwave',
    label: 'Синтвейв',
    group: 'Аниме-вайб',
    bg: '#0d0517',
    card: '#1a0d2a',
    muted: '#a998c0',
    accent: '#c026d3',
    light: '#f0abfc',
    pink: '#22d3ee',
  },
  {
    id: 'cyber',
    label: 'Киберпанк',
    group: 'Аниме-вайб',
    bg: '#0a0710',
    card: '#16111f',
    muted: '#a49cb3',
    accent: '#db2777',
    light: '#fde047',
    pink: '#22d3ee',
  },
  {
    id: 'eva',
    label: 'Ева-01',
    group: 'Аниме-вайб',
    bg: '#0b0812',
    card: '#171124',
    muted: '#a49bb8',
    accent: '#7c3aed',
    light: '#a3e635',
    pink: '#84cc16',
  },
  {
    id: 'crimson',
    label: 'Багровая луна',
    group: 'Аниме-вайб',
    bg: '#0e0607',
    card: '#1c0d0f',
    muted: '#b39596',
    accent: '#dc2626',
    light: '#fca5a5',
    pink: '#f97316',
  },
  {
    id: 'gold',
    label: 'Золото',
    group: 'Аниме-вайб',
    bg: '#0d0b06',
    card: '#1a160c',
    muted: '#b0a68d',
    accent: '#ca8a04',
    light: '#fde047',
    pink: '#f97316',
  },
  {
    id: 'peach',
    label: 'Персик',
    group: 'Аниме-вайб',
    bg: '#100a0b',
    card: '#1d1315',
    muted: '#b6a0a3',
    accent: '#e11d48',
    light: '#fda4af',
    pink: '#fdba74',
  },
  {
    id: 'lavender',
    label: 'Лаванда',
    group: 'Аниме-вайб',
    bg: '#0c0a12',
    card: '#18141f',
    muted: '#a8a0b8',
    accent: '#9333ea',
    light: '#d8b4fe',
    pink: '#f0abfc',
  },

  {
    id: 'graphite',
    label: 'Графит',
    group: 'Строгие',
    bg: '#0b0b0c',
    card: '#161618',
    muted: '#a1a1aa',
    accent: '#52525b',
    light: '#e4e4e7',
    pink: '#a1a1aa',
  },
  {
    id: 'navy',
    label: 'Тёмно-синяя',
    group: 'Строгие',
    bg: '#070a12',
    card: '#111726',
    muted: '#97a1b8',
    accent: '#1d4ed8',
    light: '#bfdbfe',
    pink: '#38bdf8',
  },
  {
    id: 'olive',
    label: 'Олива',
    group: 'Строгие',
    bg: '#0a0b07',
    card: '#151710',
    muted: '#a3a790',
    accent: '#65a30d',
    light: '#d9f99d',
    pink: '#eab308',
  },
  {
    id: 'wine',
    label: 'Вино',
    group: 'Строгие',
    bg: '#0e070b',
    card: '#1b0f16',
    muted: '#b096a5',
    accent: '#9f1239',
    light: '#fda4af',
    pink: '#c084fc',
  },

  // inspired by well-known series: their colors and a motif, no logos or artwork
  {
    id: 'scouts',
    art: scoutsArt,
    label: 'Разведкорпус',
    group: 'Уникальные',
    bg: '#0b0d0a',
    card: '#161a13',
    muted: '#a8a38e',
    accent: '#4d7c0f',
    light: '#d6c7a1',
    pink: '#60a5fa',
    pattern: 'repeating-linear-gradient(135deg, #d6c7a10a 0 2px, transparent 2px 26px), repeating-linear-gradient(45deg, #d6c7a106 0 1px, transparent 1px 52px)',
    unlock: 'min3000',
  },
  {
    id: 'leaf',
    art: leafArt,
    label: 'Деревня Листа',
    group: 'Уникальные',
    bg: '#0e0905',
    card: '#1b120a',
    muted: '#b5a08a',
    accent: '#ea580c',
    light: '#fdba74',
    pink: '#3b82f6',
    pattern: 'repeating-radial-gradient(circle at 100% 0%, #ea580c12 0 2px, transparent 2px 46px)',
    unlock: 'st7',
  },
  {
    id: 'shinigami',
    art: shinigamiArt,
    label: 'Шинигами',
    group: 'Уникальные',
    bg: '#050505',
    card: '#111111',
    muted: '#a3a3a3',
    accent: '#dc2626',
    light: '#f5f5f5',
    pink: '#f97316',
    pattern: 'linear-gradient(115deg, transparent 46%, #dc26260f 49%, #f5f5f50a 50%, #dc26260f 51%, transparent 54%)',
    unlock: 'ep100',
  },
  {
    id: 'slayer',
    art: slayerArt,
    label: 'Охотник на демонов',
    group: 'Уникальные',
    bg: '#050a07',
    card: '#0e1711',
    muted: '#97ab9c',
    accent: '#15803d',
    light: '#86efac',
    pink: '#f472b6',
    pattern: 'conic-gradient(#15803d14 25%, transparent 0 50%, #15803d14 0 75%, transparent 0)',
    patternSize: '56px 56px',
    unlock: 'done10',
  },
  {
    id: 'cursed',
    art: cursedArt,
    label: 'Проклятая энергия',
    group: 'Уникальные',
    bg: '#06050d',
    card: '#110f1f',
    muted: '#a09cbc',
    accent: '#4338ca',
    light: '#a5b4fc',
    pink: '#e879f9',
    pattern: 'repeating-conic-gradient(from 0deg at 85% 10%, #6366f10d 0 5deg, transparent 5deg 15deg)',
    unlock: 'ch100',
  },
  {
    id: 'isekai',
    art: isekaiArt,
    label: 'Перерождение',
    group: 'Уникальные',
    bg: '#09060f',
    card: '#150f1f',
    muted: '#a99fbb',
    accent: '#7c3aed',
    light: '#fcd34d',
    pink: '#f0abfc',
    pattern: 'repeating-radial-gradient(circle at 50% 38%, #fcd34d0a 0 1px, transparent 1px 36px)',
    unlock: 'ln50',
  },
  {
    id: 'grandline',
    art: grandlineArt,
    label: 'Великий путь',
    group: 'Уникальные',
    bg: '#040a10',
    card: '#0c1722',
    muted: '#9aaabb',
    accent: '#b91c1c',
    light: '#fde047',
    pink: '#0ea5e9',
    pattern: 'repeating-radial-gradient(ellipse at 50% 130%, #0ea5e910 0 2px, transparent 2px 28px)',
    unlock: 'ep1000',
  },
  {
    id: 'eightysix',
    art: eightySixArt,
    label: '86: Eighty-Six',
    group: 'Уникальные',
    bg: '#07090e',
    card: '#0f1420',
    muted: '#94a3b8',
    accent: '#0284c7',
    light: '#38bdf8',
    pink: '#ef4444',
    pattern:
      'linear-gradient(rgba(56, 189, 248, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.04) 1px, transparent 1px), radial-gradient(circle at 85% 15%, rgba(239, 68, 68, 0.08) 0%, transparent 60%)',
    patternSize: '48px 48px, 48px 48px, auto',
    unlock: 't-eightysix-n23',
  },
]

/** whether a unique theme is open for these stats (staff see all of them, to check how they look) */
export function unlocked(p: Palette, stats: Stats | null, staff = false) {
  if (!p.unlock || staff) return true
  const a = achievementById(p.unlock)
  return !!a && !!stats && a.value(stats) >= a.goal
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
/** a share `t` of color b mixed into color a */
function mix(a: string, b: string, t: number) {
  const x = hex(a)
  const y = hex(b)
  return (
    '#' +
    x
      .map((v, i) =>
        Math.round(v + (y[i] - v) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

export function paletteVars(p: Palette): Record<string, string> {
  return {
    '--color-bg': p.bg,
    '--color-bg-2': mix(p.bg, p.card, 0.45),
    '--color-card': p.card,
    '--color-card-2': mix(p.card, '#ffffff', 0.04),
    '--color-muted': p.muted,
    '--color-dim': mix(p.muted, p.bg, 0.35),
    '--color-accent': p.accent,
    '--color-accent-2': p.light,
    '--color-accent-3': mix(p.accent, '#000000', 0.3),
    '--color-pink': p.pink,
    '--color-glow': p.accent + '66',
    '--color-grad': mix(p.light, '#ffffff', 0.6),
    '--color-aura': p.accent + '1f',
    '--color-aura-2': p.pink + '14',
    '--theme-pattern': p.pattern ?? 'none',
    '--theme-art': p.art ? `url("${p.art}")` : 'none',
    '--theme-pattern-size': p.patternSize ?? 'auto',
  }
}

export const paletteById = (id: string | undefined) => PALETTES.find((p) => p.id === id) ?? PALETTES[0]
