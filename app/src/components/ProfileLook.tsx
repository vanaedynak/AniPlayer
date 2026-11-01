// How a profile can look: avatar frames, name styles, banner gradients, links and achievements.
import type { CSSProperties, ReactNode } from 'react'
import { Send, MessageCircle, PlaySquare, Tv, Globe } from 'lucide-react'
import type { Profile, ProfileStats } from '../lib/social'

export type Frame = Profile['frame']
export type NameStyle = Profile['name_style']
export type BannerStyle = Profile['banner_style']

export const FRAMES: { id: Frame; label: string }[] = [
  { id: 'none', label: 'Без рамки' },
  { id: 'accent', label: 'Цвет профиля' },
  { id: 'gradient', label: 'Градиент' },
  { id: 'glow', label: 'Свечение' },
  { id: 'gold', label: 'Золото' },
  { id: 'neon', label: 'Неон' },
  { id: 'rainbow', label: 'Радуга' },
  { id: 'sakura', label: 'Сакура' },
  { id: 'ice', label: 'Лёд' },
  { id: 'fire', label: 'Огонь' },
]

/** the ring around an avatar: a padded background behind the picture */
export function frameStyle(frame: Frame | undefined, accent: string, size: number): CSSProperties | null {
  if (!frame || frame === 'none') return null
  const pad = Math.max(2, Math.round(size * 0.05))
  const glow = (c: string) => `0 0 ${Math.round(size * 0.22)}px ${c}`
  const bg: Record<Exclude<Frame, 'none'>, CSSProperties> = {
    accent: { background: accent },
    gradient: {
      background: `linear-gradient(135deg, ${accent}, var(--color-pink))`,
    },
    glow: { background: accent, boxShadow: glow(accent) },
    gold: {
      background: 'linear-gradient(135deg, #fde68a, #f59e0b 40%, #b45309 70%, #fde68a)',
      boxShadow: glow('#f59e0b88'),
    },
    neon: {
      background: 'linear-gradient(135deg, #22d3ee, #d946ef)',
      boxShadow: `${glow('#22d3ee99')}, ${glow('#d946ef66')}`,
    },
    rainbow: {
      background: 'linear-gradient(90deg, #f43f5e, #f97316, #facc15, #22c55e, #06b6d4, #6366f1, #d946ef, #f43f5e)',
      backgroundSize: '300% 100%',
      animation: 'frame-shift 6s linear infinite',
    },
    sakura: {
      background: 'linear-gradient(135deg, #fce7f3, #f472b6, #fda4af)',
      boxShadow: glow('#f472b655'),
    },
    ice: {
      background: 'linear-gradient(135deg, #f0f9ff, #7dd3fc, #a5b4fc)',
      boxShadow: glow('#7dd3fc66'),
    },
    fire: {
      background: 'linear-gradient(135deg, #fde047, #f97316, #dc2626)',
      boxShadow: glow('#f9731688'),
    },
  }
  return { padding: pad, borderRadius: '9999px', ...bg[frame] }
}

export const NAME_STYLES: { id: NameStyle; label: string }[] = [
  { id: 'plain', label: 'Обычное' },
  { id: 'gradient', label: 'Градиент' },
  { id: 'glow', label: 'Свечение' },
  { id: 'rainbow', label: 'Радуга' },
]

export function nameStyle(style: NameStyle | undefined, accent: string): CSSProperties {
  const clip: CSSProperties = {
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  }
  if (style === 'gradient')
    return {
      ...clip,
      backgroundImage: `linear-gradient(90deg, #fff, ${accent} 55%, var(--color-pink))`,
    }
  if (style === 'glow') return { textShadow: `0 0 18px ${accent}, 0 0 4px ${accent}` }
  if (style === 'rainbow')
    return {
      ...clip,
      backgroundImage: 'linear-gradient(90deg, #f43f5e, #f97316, #facc15, #22c55e, #06b6d4, #6366f1, #d946ef, #f43f5e)',
      backgroundSize: '300% 100%',
      animation: 'frame-shift 6s linear infinite',
    }
  return {}
}

// starry sky: a handful of dots over a dark gradient
const STARS = [
  [12, 30],
  [26, 70],
  [38, 18],
  [47, 55],
  [58, 28],
  [66, 78],
  [74, 40],
  [83, 15],
  [91, 62],
  [8, 85],
  [33, 45],
  [70, 8],
]
  .map(([x, y]) => `radial-gradient(1.5px 1.5px at ${x}% ${y}%, #fff, transparent)`)
  .join(', ')

export const BANNERS: {
  id: BannerStyle
  label: string
  css: (accent: string) => string
}[] = [
  {
    id: 'accent',
    label: 'Цвет профиля',
    css: (a) => `linear-gradient(120deg, ${a}, var(--color-pink))`,
  },
  {
    id: 'sunset',
    label: 'Закат',
    css: () => 'linear-gradient(120deg, #f97316, #db2777 55%, #7c3aed)',
  },
  {
    id: 'ocean',
    label: 'Океан',
    css: () => 'linear-gradient(120deg, #0ea5e9, #2563eb 50%, #1e1b4b)',
  },
  {
    id: 'aurora',
    label: 'Сияние',
    css: () => 'linear-gradient(120deg, #022c22, #10b981 45%, #a78bfa)',
  },
  {
    id: 'sakura',
    label: 'Сакура',
    css: () => 'linear-gradient(120deg, #fbcfe8, #f472b6 50%, #9d174d)',
  },
  {
    id: 'night',
    label: 'Звёзды',
    css: () => `${STARS}, linear-gradient(160deg, #020617, #1e1b4b 60%, #4c1d95)`,
  },
  {
    id: 'fire',
    label: 'Пламя',
    css: () => 'linear-gradient(120deg, #7f1d1d, #ea580c 55%, #facc15)',
  },
  {
    id: 'mint',
    label: 'Мята',
    css: () => 'linear-gradient(120deg, #99f6e4, #14b8a6 50%, #134e4a)',
  },
  {
    id: 'cyber',
    label: 'Кибер',
    css: () => 'linear-gradient(120deg, #fde047, #db2777 50%, #22d3ee)',
  },
  {
    id: 'gold',
    label: 'Золото',
    css: () => 'linear-gradient(120deg, #422006, #ca8a04 50%, #fde68a)',
  },
]
export const bannerCss = (style: BannerStyle | undefined, accent: string) => (BANNERS.find((b) => b.id === style) ?? BANNERS[0]).css(accent)

// other pages of the user; only the name is stored, the address is built here, so nothing else can be linked
export const LINKS: {
  id: string
  label: string
  icon: ReactNode
  url?: (name: string) => string
}[] = [
  {
    id: 'telegram',
    label: 'Telegram',
    icon: <Send size={15} />,
    url: (n) => `https://t.me/${n}`,
  },
  { id: 'discord', label: 'Discord', icon: <MessageCircle size={15} /> },
  {
    id: 'shikimori',
    label: 'Shikimori',
    icon: <Globe size={15} />,
    url: (n) => `https://shikimori.one/${n}`,
  },
  {
    id: 'anilist',
    label: 'AniList',
    icon: <Globe size={15} />,
    url: (n) => `https://anilist.co/user/${n}`,
  },
  {
    id: 'mal',
    label: 'MyAnimeList',
    icon: <Globe size={15} />,
    url: (n) => `https://myanimelist.net/profile/${n}`,
  },
  {
    id: 'youtube',
    label: 'YouTube',
    icon: <PlaySquare size={15} />,
    url: (n) => `https://youtube.com/@${n}`,
  },
  {
    id: 'twitch',
    label: 'Twitch',
    icon: <Tv size={15} />,
    url: (n) => `https://twitch.tv/${n}`,
  },
]
export const cleanLink = (v: string) =>
  v
    .trim()
    .replace(/^@/, '')
    .replace(/[^\w.\-#]/g, '')
    .slice(0, 40)

export function LinkChips({ links }: { links: Record<string, string> }) {
  const shown = LINKS.filter((l) => links[l.id])
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((l) => {
        const body = (
          <>
            {l.icon} {l.url ? l.label : `${l.label}: ${links[l.id]}`}
          </>
        )
        const cls = 'flex h-8 items-center gap-1.5 rounded-full bg-white/[0.07] px-3 text-xs font-bold ring-1 ring-white/10'
        return l.url ? (
          <a key={l.id} href={l.url(links[l.id])} target="_blank" rel="noreferrer" className={`${cls} hover:bg-white/[0.12]`}>
            {body}
          </a>
        ) : (
          <span key={l.id} className={cls}>
            {body}
          </span>
        )
      })}
    </div>
  )
}

// achievements: earned from the numbers the server already counts
export interface Achievement {
  id: string
  icon: string
  label: string
  hint: string
  value: number
  goal: number
}
export function achievements(s: ProfileStats, createdAt: string): Achievement[] {
  const hours = Math.floor(s.seconds / 3600)
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000)
  return [
    {
      id: 'first',
      icon: '🎬',
      label: 'Первые шаги',
      hint: 'Досмотреть первую серию',
      value: s.episodes,
      goal: 1,
    },
    {
      id: 'ep100',
      icon: '🏃',
      label: 'Марафонец',
      hint: '100 серий',
      value: s.episodes,
      goal: 100,
    },
    {
      id: 'ep1000',
      icon: '👑',
      label: 'Легенда',
      hint: '1000 серий',
      value: s.episodes,
      goal: 1000,
    },
    {
      id: 'h10',
      icon: '⏱️',
      label: 'Втянулся',
      hint: '10 часов просмотра',
      value: hours,
      goal: 10,
    },
    {
      id: 'h100',
      icon: '🔥',
      label: 'Сотня часов',
      hint: '100 часов просмотра',
      value: hours,
      goal: 100,
    },
    {
      id: 'h500',
      icon: '🌌',
      label: 'Живёт в аниме',
      hint: '500 часов просмотра',
      value: hours,
      goal: 500,
    },
    {
      id: 'done10',
      icon: '✅',
      label: 'Закрываю гештальты',
      hint: '10 аниме просмотрено',
      value: s.completed,
      goal: 10,
    },
    {
      id: 'manga',
      icon: '📖',
      label: 'Книжный червь',
      hint: '100 глав манги',
      value: s.chapters,
      goal: 100,
    },
    {
      id: 'ln',
      icon: '📚',
      label: 'Ранобэ-гуру',
      hint: '50 глав ранобэ',
      value: s.ln_chapters,
      goal: 50,
    },
    {
      id: 'streak7',
      icon: '⚡',
      label: 'В ударе',
      hint: '7 дней подряд',
      value: s.best_streak,
      goal: 7,
    },
    {
      id: 'streak30',
      icon: '💎',
      label: 'Железная воля',
      hint: '30 дней подряд',
      value: s.best_streak,
      goal: 30,
    },
    {
      id: 'critic',
      icon: '⭐',
      label: 'Критик',
      hint: '10 оценок',
      value: s.ratings,
      goal: 10,
    },
    {
      id: 'voice',
      icon: '💬',
      label: 'Голос сообщества',
      hint: '10 комментариев',
      value: s.comments,
      goal: 10,
    },
    {
      id: 'old',
      icon: '🎂',
      label: 'Старожил',
      hint: 'Год в Anyflow',
      value: days,
      goal: 365,
    },
  ]
}
