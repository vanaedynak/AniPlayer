import { Component, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bug, RotateCcw, Copy, Check, LifeBuoy, Sparkles, Film, BookOpen, Cloud, Languages, X } from 'lucide-react'
import { SUPPORT_URL } from '../lib/links'

/**
 * A page that crashed shows this instead of a blank screen; the rest of the app keeps working.
 * Keyed by the route, so going to another page starts clean.
 */
export class CrashGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('[crash]', error)
  }
  render() {
    return this.state.error ? <CrashScreen error={this.state.error} retry={() => this.setState({ error: null })} /> : this.props.children
  }
}

function CrashScreen({ error, retry }: { error: Error; retry: () => void }) {
  const [copied, setCopied] = useState(false)
  const report = `${error.name}: ${error.message}\n${location.hash}\nAniPlayer ${__APP_VERSION__}\n${navigator.userAgent}\n\n${error.stack ?? ''}`
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-300">
        <Bug size={30} />
      </div>
      <h1 className="text-2xl font-extrabold">Эта страница сломалась</h1>
      <p className="text-sm leading-relaxed text-muted">Остальное приложение работает. Попробуйте ещё раз — а если повторится, отправьте отчёт в поддержку, это поможет быстро починить.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button onClick={retry} className="flex h-11 items-center gap-2 rounded-full bg-white px-5 font-bold text-black">
          <RotateCcw size={16} /> Ещё раз
        </button>
        <button
          onClick={() => void navigator.clipboard.writeText(report).then(() => setCopied(true))}
          className="flex h-11 items-center gap-2 rounded-full bg-white/10 px-5 font-bold hover:bg-white/15"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Скопировано' : 'Скопировать отчёт'}
        </button>
        <a href={SUPPORT_URL} target="_blank" rel="noreferrer" className="flex h-11 items-center gap-2 rounded-full bg-white/10 px-5 font-bold hover:bg-white/15">
          <LifeBuoy size={16} /> Поддержка
        </a>
      </div>
      <Link to="/" className="text-sm font-bold text-accent-2">
        На главную
      </Link>
      <pre className="max-h-40 w-full overflow-auto rounded-2xl bg-white/[0.04] p-3 text-left text-[11px] text-white/50">{error.message}</pre>
    </div>
  )
}

const WELCOME_KEY = 'aniplayer-welcome'

/** a short tour on the very first launch */
export function Welcome() {
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem(WELCOME_KEY) && !localStorage.getItem('aniplayer-store')
    } catch {
      return false
    }
  })
  if (!open) return null
  const close = () => {
    try {
      localStorage.setItem(WELCOME_KEY, '1')
    } catch {
      /* ignore */
    }
    setOpen(false)
  }
  const points = [
    { icon: <Film size={18} className="text-accent-2" />, t: 'Аниме', d: 'Озвучка AniLibria и десятки других студий, все серии сезона одним списком, пропуск опенингов.' },
    { icon: <BookOpen size={18} className="text-pink" />, t: 'Манга и ранобэ', d: 'Каталоги на русском и английском, читалка с темами и закладкой на месте, где остановились.' },
    { icon: <Languages size={18} className="text-sky-300" />, t: 'Перевод и озвучка', d: 'Английские главы переводит нейросеть, текст можно слушать разными голосами.' },
    { icon: <Cloud size={18} className="text-emerald-300" />, t: 'Аккаунт', d: 'Войдите в настройках — история и прогресс будут одинаковыми на компьютере и телефоне.' },
  ]
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="animate-pop relative w-full max-w-md rounded-[28px] bg-card p-6 ring-1 ring-white/10">
        <button onClick={close} className="absolute top-4 right-4 text-muted hover:text-white" title="Закрыть">
          <X size={20} />
        </button>
        <div className="mb-1 flex items-center gap-2 text-2xl font-extrabold">
          <Sparkles className="text-accent-2" /> Добро пожаловать
        </div>
        <div className="mb-5 text-sm font-semibold text-muted">Коротко о том, что умеет AniPlayer</div>
        <div className="flex flex-col gap-4">
          {points.map((p) => (
            <div key={p.t} className="flex gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">{p.icon}</span>
              <div>
                <div className="font-bold">{p.t}</div>
                <div className="text-sm leading-relaxed text-white/70">{p.d}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex gap-2">
          <button onClick={close} className="h-12 flex-1 rounded-full bg-white font-extrabold text-black">
            Начать
          </button>
          <Link to="/settings" onClick={close} className="flex h-12 items-center rounded-full bg-white/10 px-5 font-bold hover:bg-white/15">
            Войти
          </Link>
        </div>
      </div>
    </div>
  )
}
