// The start of every launch: a loader in the theme's own look that really fetches what the first screen needs,
// and, without an account, the sign in / sign up card (or watching as a guest).
import { useEffect, useState, type ReactNode } from 'react'
import { History, Library, BookOpen, Trophy, MessageCircle, MonitorSmartphone, X, UserRound } from 'lucide-react'
import { useSync, waitForFirstSync } from '../lib/sync'
import { useGuest } from '../lib/guest'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { paletteById } from '../lib/palettes'
import { AccountForm } from './AccountForm'
import { cn } from '../lib/format'

type Phase = 'auth' | 'gate' | 'load' | 'done'

/** never wait on one step forever: offline the app still opens */
const capped = (p: Promise<unknown>, ms: number) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, ms))])

const STEPS = ['Проверяем аккаунт', 'Синхронизируем историю и коллекцию', 'Загружаем новые серии и расписание', 'Готовим тему оформления'] as const

export function Boot({ children }: { children: ReactNode }) {
  const ready = useSync((s) => s.ready)
  const user = useSync((s) => s.user)
  const [phase, setPhase] = useState<Phase>('auth')
  const [step, setStep] = useState(0)
  const [leaving, setLeaving] = useState(false)

  // no internet at the start: no sign-in card and no loader waiting on servers. The app opens on what is
  // downloaded, with the account (if one was signed in on this device) kept as it was until the network returns.
  useEffect(() => {
    if (phase !== 'auth' || navigator.onLine) return
    if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/downloads'
    setPhase('done')
  }, [phase])

  // step 1: the saved session, or the account from the device keychain
  useEffect(() => {
    if (phase !== 'auth') return
    if (ready) return setPhase(user ? 'load' : navigator.onLine ? 'gate' : 'done')
    const t = setTimeout(() => setPhase(useSync.getState().user ? 'load' : navigator.onLine ? 'gate' : 'done'), 6000)
    return () => clearTimeout(t)
  }, [phase, ready, user])

  // the network went away while the sign-in card was up: let the person in to their downloads
  useEffect(() => {
    if (phase !== 'gate') return
    const off = () => {
      location.hash = '#/downloads'
      setPhase('done')
    }
    window.addEventListener('offline', off)
    return () => window.removeEventListener('offline', off)
  }, [phase])

  // signing in on the card goes straight on to loading
  useEffect(() => {
    if (phase === 'gate' && user) setPhase('load')
  }, [phase, user])

  // steps 2–4: the account's data, the home page's lists, the theme's picture and fonts
  useEffect(() => {
    if (phase !== 'load') return
    let alive = true
    const started = Date.now()
    void (async () => {
      setStep(1)
      if (useSync.getState().user) await capped(waitForFirstSync(6000), 6000)
      if (!alive) return
      setStep(2)
      await capped(Promise.all([api.latest(24), api.scheduleWeek()]), 6000)
      if (!alive) return
      setStep(3)
      const art = paletteById(useStore.getState().local.theme).art
      await capped(
        Promise.all([
          document.fonts?.ready,
          art &&
            new Promise((r) => {
              const img = new Image()
              img.onload = img.onerror = r
              img.src = art
            }),
        ]),
        3000,
      )
      // a short beat so the loader never just flickers
      await new Promise((r) => setTimeout(r, Math.max(0, 700 - (Date.now() - started))))
      if (!alive) return
      setStep(4)
      setLeaving(true)
      setTimeout(() => alive && setPhase('done'), 350)
    })()
    return () => {
      alive = false
    }
  }, [phase])

  return (
    <>
      {phase !== 'auth' && phase !== 'gate' && children}
      {phase !== 'done' && (
        <div className={cn('fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-bg p-4 transition-opacity duration-300', leaving && 'opacity-0')}>
          <div className="theme-art" aria-hidden />
          {phase === 'gate' ? <Gate onGuest={() => setPhase('load')} /> : <Loader step={step} />}
        </div>
      )}
      <SignUpCard />
    </>
  )
}

function Loader({ step }: { step: number }) {
  const pct = Math.round((Math.min(step, STEPS.length) / STEPS.length) * 100)
  return (
    <div className="animate-pop relative flex w-full max-w-xs flex-col items-center gap-5 rounded-[28px] bg-bg/70 px-6 py-8 text-center backdrop-blur-md">
      <ThemeSpinner />
      <div className="text-lg font-extrabold">Загрузка…</div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-pink transition-[width] duration-500" style={{ width: `${Math.max(6, pct)}%` }} />
      </div>
      <div className="min-h-5 text-sm font-semibold text-white/75">{STEPS[Math.min(step, STEPS.length - 1)]}</div>
      <div className="text-xs font-semibold text-muted">Anyflow v{__APP_VERSION__}</div>
    </div>
  )
}

const PERKS = [
  { icon: History, t: 'История и «Продолжить просмотр»', d: 'с той же секунды, где остановились' },
  { icon: Library, t: 'Коллекция и списки', d: '«Смотрю», «В планах», избранное' },
  { icon: BookOpen, t: 'Полка манги и ранобэ', d: 'закладки и прочитанные главы' },
  { icon: Trophy, t: 'Статистика и достижения', d: 'и уникальные темы за них' },
  { icon: MessageCircle, t: 'Комментарии и совместный просмотр', d: 'профиль, лайки, комнаты' },
  { icon: MonitorSmartphone, t: 'Всё одинаково на ПК, iPad и телефоне', d: 'синхронизация сама' },
]

function Perks() {
  return (
    <div className="grid gap-2.5">
      {PERKS.map(({ icon: Icon, t, d }) => (
        <div key={t} className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-2">
            <Icon size={16} />
          </span>
          <div className="text-sm leading-tight">
            <div className="font-bold">{t}</div>
            <div className="text-muted">{d}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function Gate({ onGuest }: { onGuest: () => void }) {
  return (
    <div className="animate-pop relative my-auto grid w-full max-w-3xl gap-6 rounded-[28px] bg-card/90 p-6 ring-1 ring-white/10 backdrop-blur-md sm:p-8 md:grid-cols-2">
      <div className="flex flex-col gap-5">
        <div>
          <div className="bg-gradient-to-r from-accent-2 to-pink bg-clip-text text-3xl font-black text-transparent">Anyflow</div>
          <div className="mt-1 text-sm font-semibold text-muted">Аниме, манга и ранобэ в одном месте</div>
        </div>
        <div className="text-sm font-bold text-white/80">С аккаунтом сохраняется всё:</div>
        <Perks />
      </div>
      <div className="flex flex-col gap-4">
        <AccountForm />
        <div className="flex items-center gap-3 text-xs font-semibold text-dim">
          <span className="h-px flex-1 bg-white/10" /> или <span className="h-px flex-1 bg-white/10" />
        </div>
        <button
          onClick={onGuest}
          className="flex items-center justify-center gap-2 rounded-2xl bg-white/[0.07] py-3 font-bold ring-1 ring-white/10 transition hover:bg-white/[0.12]"
        >
          <UserRound size={18} /> Смотреть как гость
        </button>
        <p className="text-xs leading-relaxed text-muted">
          Гостем можно смотреть и читать, но ничего не сохранится: ни история, ни коллекция, ни прогресс. Комментарии тоже только с аккаунтом.
        </p>
      </div>
    </div>
  )
}

/** a guest pressed something that keeps data: say why an account is needed, with the form right here */
function SignUpCard() {
  const ask = useGuest((s) => s.ask)
  if (!ask) return null
  const close = () => useGuest.setState({ ask: null })
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onClick={close}>
      <div className="animate-pop relative my-auto w-full max-w-md rounded-[28px] bg-card p-6 ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <button onClick={close} className="absolute top-4 right-4 text-muted hover:text-white" title="Закрыть">
          <X size={20} />
        </button>
        <div className="text-xl font-extrabold">Нужен аккаунт</div>
        <div className="mt-1 mb-5 text-sm font-semibold text-muted">
          <span className="text-white">{ask}</span> — только для зарегистрированных. Это бесплатно и занимает полминуты.
        </div>
        <AccountForm initial="up" />
      </div>
    </div>
  )
}

/* ---- the spinner: every theme spins something of its own ---- */

const SPIN = { transformOrigin: '50px 50px' } as const

function ThemeSpinner() {
  const theme = useStore((s) => s.local.theme)
  const id = paletteById(theme).id
  const art = SPINNERS[id] ?? ring
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 drop-shadow-[0_0_18px_var(--color-glow)]" aria-hidden>
      {art()}
    </svg>
  )
}

/** the default: a gradient arc, like a classic loader */
function ring() {
  return (
    <>
      <defs>
        <linearGradient id="boot-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-accent-2)" />
          <stop offset="1" stopColor="var(--color-pink)" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="34" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="7" />
      <circle
        cx="50"
        cy="50"
        r="34"
        fill="none"
        stroke="url(#boot-g)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray="70 214"
        className="animate-spin"
        style={{ ...SPIN, animationDuration: '1s' }}
      />
    </>
  )
}

/** a swirl of fox-fire flames, nine of them */
function flames() {
  return (
    <g className="animate-spin" style={{ ...SPIN, animationDuration: '2.4s' }}>
      {Array.from({ length: 9 }, (_, i) => (
        <path
          key={i}
          d="M50 50 C58 40 60 26 52 12 C50 24 44 30 42 40 C41 45 45 49 50 50Z"
          fill={i % 2 ? 'var(--color-accent)' : 'var(--color-accent-2)'}
          opacity={0.55 + (i % 3) * 0.15}
          transform={`rotate(${i * 40} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="7" fill="var(--color-pink)" />
    </g>
  )
}

/** a crescent moon circling inside a thin ring */
function moon() {
  return (
    <>
      <circle cx="50" cy="50" r="38" fill="none" stroke="var(--color-accent-2)" strokeOpacity=".25" strokeWidth="2" />
      <g className="animate-spin" style={{ ...SPIN, animationDuration: '2.2s' }}>
        <path d="M50 14 A36 36 0 1 0 86 50 A28 28 0 1 1 50 14Z" fill="var(--color-accent-2)" />
      </g>
    </>
  )
}

/** waves running round a circle */
function waves() {
  return (
    <g className="animate-spin" style={{ ...SPIN, animationDuration: '1.8s' }}>
      {Array.from({ length: 6 }, (_, i) => (
        <path
          key={i}
          d="M50 14 q10 6 4 16 q-6 8 4 14"
          fill="none"
          stroke={i % 2 ? 'var(--color-pink)' : 'var(--color-accent-2)'}
          strokeWidth="5"
          strokeLinecap="round"
          transform={`rotate(${i * 60} 50 50)`}
        />
      ))}
    </g>
  )
}

/** paper seals turning around a square ward */
function seals() {
  return (
    <>
      <rect
        x="32"
        y="32"
        width="36"
        height="36"
        rx="3"
        fill="none"
        stroke="var(--color-pink)"
        strokeWidth="3"
        className="animate-spin"
        style={{ ...SPIN, animationDuration: '3s', animationDirection: 'reverse' }}
      />
      <g className="animate-spin" style={{ ...SPIN, animationDuration: '1.6s' }}>
        {Array.from({ length: 4 }, (_, i) => (
          <g key={i} transform={`rotate(${i * 90} 50 50)`}>
            <rect x="45" y="6" width="10" height="20" rx="1.5" fill="var(--color-accent-2)" />
            <path d="M48 11h4M48 16h4M48 21h4" stroke="var(--color-bg)" strokeWidth="1.5" />
          </g>
        ))}
      </g>
    </>
  )
}

/** a ship's wheel */
function wheel() {
  return (
    <g className="animate-spin" style={{ ...SPIN, animationDuration: '2.6s' }}>
      <circle cx="50" cy="50" r="26" fill="none" stroke="var(--color-accent-2)" strokeWidth="6" />
      <circle cx="50" cy="50" r="7" fill="var(--color-pink)" />
      {Array.from({ length: 8 }, (_, i) => (
        <g key={i} transform={`rotate(${i * 45} 50 50)`}>
          <line x1="50" y1="50" x2="50" y2="10" stroke="var(--color-accent-2)" strokeWidth="4" strokeLinecap="round" />
          <circle cx="50" cy="9" r="4" fill="var(--color-accent)" />
        </g>
      ))}
    </g>
  )
}

/** a magic circle: two rings turning against each other */
function circle() {
  return (
    <>
      <g className="animate-spin" style={{ ...SPIN, animationDuration: '4s' }}>
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--color-accent-2)" strokeWidth="2" strokeDasharray="4 3" />
        <path d="M50 14 L81 68 L19 68Z M50 86 L19 32 L81 32Z" fill="none" stroke="var(--color-accent-2)" strokeWidth="2" />
      </g>
      <g className="animate-spin" style={{ ...SPIN, animationDuration: '2.5s', animationDirection: 'reverse' }}>
        <circle cx="50" cy="50" r="18" fill="none" stroke="var(--color-pink)" strokeWidth="3" strokeDasharray="10 6" />
      </g>
    </>
  )
}

/** crossed blades inside a turning double ring */
function blades() {
  return (
    <>
      <g className="animate-spin" style={{ ...SPIN, animationDuration: '1.4s' }}>
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--color-accent-2)" strokeWidth="4" strokeDasharray="60 191" strokeLinecap="round" />
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--color-pink)" strokeWidth="4" strokeDasharray="60 191" strokeDashoffset="-125" strokeLinecap="round" />
      </g>
      <g stroke="var(--color-accent-2)" strokeWidth="4" strokeLinecap="round">
        <line x1="34" y1="66" x2="66" y2="30" />
        <line x1="66" y1="66" x2="34" y2="30" />
      </g>
    </>
  )
}

/** five petals turning */
function petals() {
  return (
    <g className="animate-spin" style={{ ...SPIN, animationDuration: '3s' }}>
      {Array.from({ length: 5 }, (_, i) => (
        <path key={i} d="M50 50 C40 38 42 20 50 14 C58 20 60 38 50 50Z" fill="var(--color-accent-2)" opacity={0.6 + (i % 2) * 0.3} transform={`rotate(${i * 72} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="5" fill="var(--color-pink)" />
    </g>
  )
}

const SPINNERS: Record<string, () => ReactNode> = {
  leaf: flames,
  shinigami: moon,
  slayer: waves,
  ocean: waves,
  cursed: seals,
  grandline: wheel,
  isekai: circle,
  cosmos: circle,
  scouts: blades,
  crimson: blades,
  sakura: petals,
  peach: petals,
  lavender: petals,
}
