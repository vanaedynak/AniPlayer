import { useEffect, type CSSProperties } from 'react'
import { useManga, type Ambience as Amb } from '../manga/store'
import { setAmbient } from '../lib/ambientSound'
import { usePowerSave } from '../lib/power'

// Paper textures, drawn by the browser from SVG noise (nothing to download). Light paper takes a brown
// grain multiplied in; dark paper a faint light one.
const svg = (body: string, size = 260) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>${body}</svg>`)}")`

const grain = (rgb: string, freq: string, oct: number, a: number, b: number, size?: number) => {
  const [r, g, bl] = rgb.split(',').map((v) => Number(v) / 255)
  return svg(
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='${oct}' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${bl} ${a} 0 0 0 ${b}'/></filter><rect width='100%' height='100%' filter='url(#n)'/>`,
    size,
  )
}

function textureLayers(t: Amb['texture'], dark: boolean): CSSProperties | null {
  const ink = dark ? '255,240,215' : '110,80,40'
  if (t === 'paper')
    return {
      backgroundImage: [grain(ink, '0.9', 3, 1.6, -0.75), grain(ink, '0.035', 3, 0.9, -0.42, 520)].join(','),
      opacity: dark ? 0.16 : 0.42,
    }
  if (t === 'old')
    return {
      backgroundImage: [
        grain(ink, '0.8', 3, 1.6, -0.7),
        grain(ink, '0.012', 4, 1.3, -0.45, 700),
        grain(ink, '0.015 0.5', 2, 1.4, -0.75, 400),
        `radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(${ink},${dark ? 0.12 : 0.35}) 100%)`,
      ].join(','),
      opacity: dark ? 0.2 : 0.62,
    }
  if (t === 'linen')
    return {
      backgroundImage: [grain(ink, '0.9 0.03', 2, 1.5, -0.6), grain(ink, '0.03 0.9', 2, 1.5, -0.6), grain(ink, '0.9', 2, 1.2, -0.7)].join(','),
      opacity: dark ? 0.16 : 0.5,
    }
  return null
}

/** the layers laid over a reader's page: texture, light, warmth, dimming. They never catch a tap. */
export function AmbienceLayer({ dark, className }: { dark: boolean; className?: string }) {
  const a = useManga((s) => s.amb)
  // power saving keeps only what the eyes need at night: warmth and dimming; texture and light are blended layers
  const power = usePowerSave()
  const tex = power ? null : textureLayers(a.texture, dark)
  return (
    <div className={className ?? 'pointer-events-none absolute inset-0 z-[5]'} aria-hidden>
      {tex && <div className="absolute inset-0" style={{ ...tex, mixBlendMode: dark ? 'screen' : 'multiply' }} />}
      {!power && a.light === 'lamp' && (
        <>
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 75% 65% at 50% 30%, rgba(255,205,130,.28), transparent 72%)', mixBlendMode: dark ? 'screen' : 'soft-light' }} />
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 90% 85% at 50% 35%, transparent 58%, rgba(20,10,0,.26) 100%)' }} />
        </>
      )}
      {!power && a.light === 'window' && (
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(105deg, rgba(215,232,255,.22) 0%, rgba(215,232,255,.06) 35%, transparent 55%, rgba(0,0,0,.2) 100%)', mixBlendMode: dark ? 'screen' : 'normal' }}
        />
      )}
      {a.warmth > 0 && <div className="absolute inset-0" style={{ background: 'rgb(255,146,54)', opacity: a.warmth * 0.38, mixBlendMode: 'multiply' }} />}
      {a.dim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: a.dim }} />}
    </div>
  )
}

/** keeps the chosen room sound playing while a reader is open; the browser lets it start on the first tap */
export function useAmbientSound() {
  const chosen = useManga((s) => s.amb.sound)
  const volume = useManga((s) => s.amb.volume)
  const power = usePowerSave()
  const sound = power ? 'off' : chosen
  useEffect(() => {
    if (sound === 'off') return setAmbient('off', 0)
    const start = () => setAmbient(sound, volume)
    start()
    window.addEventListener('pointerdown', start, { once: true })
    window.addEventListener('keydown', start, { once: true })
    return () => {
      window.removeEventListener('pointerdown', start)
      window.removeEventListener('keydown', start)
    }
  }, [sound, volume])
  useEffect(() => () => setAmbient('off', 0), [])
}

export const TEXTURES: { v: Amb['texture']; l: string }[] = [
  { v: 'none', l: 'Гладкая' },
  { v: 'paper', l: 'Бумага' },
  { v: 'old', l: 'Старая' },
  { v: 'linen', l: 'Лён' },
]
export const LIGHTS: { v: Amb['light']; l: string }[] = [
  { v: 'none', l: 'Ровный' },
  { v: 'lamp', l: 'Лампа' },
  { v: 'window', l: 'Окно' },
]
export const SOUNDS: { v: Amb['sound']; l: string }[] = [
  { v: 'off', l: 'Тишина' },
  { v: 'rain', l: 'Дождь' },
  { v: 'fire', l: 'Камин' },
  { v: 'night', l: 'Ночь' },
]
