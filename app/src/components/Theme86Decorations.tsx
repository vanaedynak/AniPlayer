import { useState } from 'react'
import { cn } from '../lib/format'
import chibiLenaImg from '../assets/theme-art/chibi-lena-opt.webp'
import fidoImg from '../assets/theme-art/fido.webp'

const LENA_QUOTES = [
  'Куратор Один на связи.',
  'Отряду «Остриё копья» — держаться вместе!',
  'Син, вы меня слышите?',
  'Мы обязательно встретимся снова.',
  'Никаких потерь в сегодняшнем бою!',
  'Пока мы живы — мы выбираем, как бороться.',
  'Я не забуду ни одного из вас.',
]

const FIDO_QUOTES = [
  'Вуф! (Фидо радостно виляет антенной-хвостиком)',
  'Бип-бип! Патроны для Джаггернаута доставлены.',
  'Вуф! Следую за процессором «Могильщик».',
  'Тяв! Майор Милизе погладила сенсор.',
  'Бип! Сектор чист, сигналов Легиона нет.',
  'Вуф-вуф! Всегда рядом с отрядом «Остриё копья».',
]

/** Interactive Chibi Lena mascot for the sidebar / dashboard */
export function Theme86SidebarMascot() {
  const [quoteIdx, setQuoteIdx] = useState(0)
  const [bubble, setBubble] = useState(false)

  const nextQuote = () => {
    setQuoteIdx((i) => (i + 1) % LENA_QUOTES.length)
    setBubble(true)
  }

  return (
    <div className="relative mt-2 flex flex-col items-center px-2 py-3 rounded-2xl border border-sky-400/25 bg-gradient-to-b from-sky-950/40 to-slate-950/70 backdrop-blur-md shadow-[0_8px_24px_-8px_rgba(56,189,248,0.25)] group">
      {/* Tactical Header Badge */}
      <div className="flex items-center justify-between w-full px-2 mb-2">
        <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold tracking-widest text-sky-400 uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" />
          HANDLER ONE
        </span>
        <span className="text-[9px] font-mono text-white/40">SAN MAGNOLIA</span>
      </div>

      {/* Speech Bubble */}
      <div
        className={cn(
          'absolute -top-14 left-1/2 -translate-x-1/2 w-52 rounded-xl bg-sky-950/95 border border-sky-400/40 p-2 text-center text-[11px] font-semibold text-sky-100 shadow-[0_4px_18px_rgba(56,189,248,0.3)] transition-all duration-300 pointer-events-none z-50',
          bubble ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100',
        )}
      >
        <span>{LENA_QUOTES[quoteIdx]}</span>
        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rotate-45 bg-sky-950 border-r border-b border-sky-400/40" />
      </div>

      {/* Chibi Character Artwork */}
      <button
        onClick={nextQuote}
        title="Нажмите, чтобы поговорить с майором Милизе"
        className="relative block cursor-pointer transition-transform duration-300 hover:scale-105 active:scale-95"
      >
        <img
          src={chibiLenaImg}
          alt="Major Vladilena Milizé"
          className="h-28 w-auto object-contain drop-shadow-[0_8px_16px_rgba(56,189,248,0.35)]"
        />
      </button>

      {/* Tactical Sub-label */}
      <div className="mt-1 text-center">
        <div className="text-[11px] font-bold text-white tracking-wide">Майор Милизе</div>
        <div className="text-[9px] font-mono text-sky-300/70">«Куратор Один»</div>
      </div>
    </div>
  )
}

/** Interactive Fido the Scavenger Dog mascot */
export function Theme86FidoMascot() {
  const [quoteIdx, setQuoteIdx] = useState(0)
  const [bubble, setBubble] = useState(false)
  const [petted, setPetted] = useState(false)

  const interact = () => {
    setQuoteIdx((i) => (i + 1) % FIDO_QUOTES.length)
    setBubble(true)
    setPetted(true)
    setTimeout(() => setPetted(false), 1200)
  }

  return (
    <div className="fixed bottom-4 right-6 z-30 hidden sm:flex flex-col items-end select-none group">
      {/* Speech Bubble */}
      <div
        className={cn(
          'mb-2 max-w-[240px] rounded-2xl border border-sky-400/40 bg-slate-950/90 px-3 py-2 text-xs font-medium text-sky-200 shadow-[0_4px_20px_rgba(2,132,199,0.35)] backdrop-blur-md transition-all duration-300 pointer-events-none',
          bubble
            ? 'opacity-100 translate-y-0 scale-100'
            : 'opacity-0 translate-y-2 scale-95 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100',
        )}
      >
        <div className="flex items-center gap-1.5 mb-1 text-[10px] font-mono font-bold text-sky-400 uppercase tracking-wider">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-ping" />
          M4A3 SCAVENGER // FIDO
        </div>
        <div>{FIDO_QUOTES[quoteIdx]}</div>
        {petted && <div className="mt-1 text-[10px] font-bold text-rose-400 animate-bounce">❤ Фидо доволен!</div>}
      </div>

      {/* Fido button */}
      <button
        onClick={interact}
        title="Погладить Фидо (робот-собака отряда «Остриё копья»)"
        className="relative cursor-pointer transition-transform duration-300 hover:scale-110 active:scale-95 focus:outline-none"
      >
        <img
          src={fidoImg}
          alt="Fido Scavenger"
          className="h-20 w-auto object-contain drop-shadow-[0_8px_20px_rgba(56,189,248,0.35)] animate-pulse"
          style={{ animationDuration: '4s' }}
        />
        {/* Status LED ring */}
        <span className="absolute bottom-1 right-2 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
        </span>
      </button>
    </div>
  )
}

/** Ambient floating Lycoris (red spider lily) petals drifting across the atmosphere */
export function Theme86Petals() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div className="petal-flow petal-1" />
      <div className="petal-flow petal-2" />
      <div className="petal-flow petal-3" />
      <div className="petal-flow petal-4" />
      <div className="petal-flow petal-5" />
    </div>
  )
}

/** Undertaker's Headless Skeleton Knight Emblem (Personal Mark of Shin Nouzen) */
export function UndertakerMarkIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M 12 3 L 18 5 L 18 12 C 18 16.5 12 21 12 21 C 12 21 6 16.5 6 12 L 6 5 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <line x1="9" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="10" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="11" y1="15" x2="13" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 4 20 L 19 5" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
      <path d="M 17 3 L 21 7 L 19 9 L 15 5 Z" fill="#ef4444" />
      <circle cx="12" cy="7" r="1.5" fill="#38bdf8" />
    </svg>
  )
}

/** Juggernaut M1A4 Quadruped Walker Mecha Icon */
export function JuggernautIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M 7 9 L 17 9 L 19 14 L 5 14 Z" stroke="currentColor" strokeWidth="1.6" fill="currentColor" fillOpacity="0.18" />
      <line x1="12" y1="9" x2="12" y2="3" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="3" r="1" fill="#38bdf8" />
      <path d="M 6 14 L 3 18 L 2 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 18 14 L 21 18 L 22 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 9 14 L 8 18 L 7 21" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M 15 14 L 16 18 L 17 21" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="12" cy="11.5" r="1.5" fill="#ef4444" />
    </svg>
  )
}

/** Tactical Para-RAID Frequency / Radar Dish Icon */
export function RadarDishIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 3" opacity="0.6" />
      <circle cx="12" cy="12" r="5" stroke="#38bdf8" strokeWidth="1.5" />
      <line x1="12" y1="12" x2="18" y2="8" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.8" fill="#38bdf8" />
      <circle cx="18" cy="8" r="1.2" fill="#ef4444" />
    </svg>
  )
}

/** Tactical Military Dog Tags Icon */
export function DogTagsIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M 6 4 C 6 2.5 8 2 10 2 C 12 2 14 2.5 14 4 L 14 13 C 14 14.5 12 15 10 15 C 8 15 6 14.5 6 13 Z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      <path d="M 11 8 C 11 6.5 13 6 15 6 C 17 6 19 6.5 19 8 L 19 17 C 19 18.5 17 19 15 19 C 13 19 11 18.5 11 17 Z" stroke="#38bdf8" strokeWidth="1.5" fill="#38bdf8" fillOpacity="0.12" />
      <circle cx="10" cy="5" r="1" fill="currentColor" />
      <circle cx="15" cy="9" r="1" fill="#38bdf8" />
      <line x1="8" y1="9" x2="12" y2="9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="8" y1="11" x2="11" y2="11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

/** Armored Supply Depot / Ammo Crate Icon */
export function SupplyDepotIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="6" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" fill="currentColor" fillOpacity="0.15" />
      <line x1="3" y1="13" x2="21" y2="13" stroke="#38bdf8" strokeWidth="1.4" />
      <line x1="8" y1="6" x2="8" y2="20" stroke="currentColor" strokeWidth="1.2" />
      <line x1="16" y1="6" x2="16" y2="20" stroke="currentColor" strokeWidth="1.2" />
      <rect x="10" y="11" width="4" height="4" rx="1" fill="#ef4444" />
    </svg>
  )
}

/** San Magnolia Republic Star Medal Icon */
export function MagnoliaMedalIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M 8 2 L 12 7 L 16 2 L 14 9 L 10 9 Z" fill="#38bdf8" fillOpacity="0.4" stroke="#38bdf8" strokeWidth="1.2" />
      <circle cx="12" cy="15" r="6" stroke="currentColor" strokeWidth="1.6" fill="currentColor" fillOpacity="0.2" />
      <path d="M 12 11 L 13.2 13.5 L 16 13.8 L 14 15.6 L 14.5 18.4 L 12 17 L 9.5 18.4 L 10 15.6 L 8 13.8 L 10.8 13.5 Z" fill="#fde047" />
    </svg>
  )
}

/** Lycoris Radiata (Red Spider Lily) Icon */
export function LycorisIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <line x1="12" y1="21" x2="12" y2="13" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 12 13 C 8 11 5 6 6 3" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 12 13 C 16 11 19 6 18 3" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 12 13 C 9 10 7 4 10 2" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 12 13 C 15 10 17 4 14 2" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 12 13 C 11 8 12 4 12 2" stroke="#f43f5e" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="6" cy="3" r="1" fill="#fde047" />
      <circle cx="18" cy="3" r="1" fill="#fde047" />
      <circle cx="10" cy="2" r="1" fill="#fde047" />
      <circle cx="14" cy="2" r="1" fill="#fde047" />
      <circle cx="12" cy="2" r="1" fill="#fde047" />
    </svg>
  )
}
