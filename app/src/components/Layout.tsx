import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import {
  Home,
  LayoutGrid,
  CalendarDays,
  History,
  Library,
  BarChart3,
  Settings,
  Search,
  X,
  Cloud,
  CloudOff,
  Loader2,
  Star,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react'
import { api, posterUrl, type Release } from '../lib/api'
import { useSync } from '../lib/sync'
import { isElectron } from '../lib/platform'
import { cn } from '../lib/format'

const NAV = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/catalog', label: 'Каталог', icon: LayoutGrid },
  { to: '/schedule', label: 'Расписание', icon: CalendarDays },
  { to: '/history', label: 'История', icon: History },
  { to: '/collection', label: 'Моя коллекция', icon: Library },
  { to: '/stats', label: 'Статистика', icon: BarChart3 },
]

const TABS = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/catalog', label: 'Каталог', icon: LayoutGrid },
  { to: '/search', label: 'Поиск', icon: Search },
  { to: '/history', label: 'История', icon: History },
  { to: '/collection', label: 'Коллекция', icon: Library },
  { to: '/stats', label: 'Профиль', icon: BarChart3 },
]

export function Logo() {
  return (
    <Link to="/" className="no-drag flex items-center gap-2.5">
      <img src="favicon.svg" alt="" className="h-10 w-10 drop-shadow-[0_6px_18px_rgba(139,92,246,0.45)]" />
      <span className="text-[22px] font-extrabold tracking-tight">
        ani<span className="text-gradient">player</span>
      </span>
    </Link>
  )
}

function SyncBadge() {
  const { status } = useSync()
  const map = {
    disabled: { icon: CloudOff, text: 'Синхронизация выключена', cls: 'text-dim' },
    'signed-out': { icon: CloudOff, text: 'Войдите, чтобы синхронизировать', cls: 'text-yellow-400' },
    connecting: { icon: Loader2, text: 'Синхронизация…', cls: 'text-muted animate-spin' },
    synced: { icon: Cloud, text: 'Синхронизировано', cls: 'text-emerald-400' },
    offline: { icon: CloudOff, text: 'Офлайн — сохраним позже', cls: 'text-yellow-400' },
    error: { icon: CloudOff, text: 'Ошибка синхронизации', cls: 'text-rose-400' },
  }[status]
  const Icon = map.icon
  return (
    <Link to="/settings" title={map.text} className="no-drag flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
      <Icon size={20} className={map.cls} />
    </Link>
  )
}

function SearchBox() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Release[]>([])
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState(0)
  const nav = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'k')) && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setItems([])
      return
    }
    setLoading(true)
    const t = setTimeout(() => {
      api
        .search(query)
        .then((r) => {
          setItems(r.slice(0, 8))
          setSel(0)
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const go = (r: Release) => {
    setOpen(false)
    setQ('')
    inputRef.current?.blur()
    nav(`/title/${r.alias}`)
  }

  return (
    <div className="no-drag relative w-full max-w-xl">
      <div
        className={cn(
          'flex h-12 items-center gap-3 rounded-full bg-white/[0.07] px-5 ring-1 ring-white/5 transition',
          open && 'bg-white/10 ring-accent/50',
        )}
      >
        <Search size={18} className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSel((s) => Math.min(items.length - 1, s + 1))
            else if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1))
            else if (e.key === 'Enter') {
              if (items[sel]) go(items[sel])
              else if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`)
            } else if (e.key === 'Escape') inputRef.current?.blur()
          }}
          placeholder="Быстрый поиск"
          className="h-full w-full bg-transparent text-[15px] font-semibold outline-none placeholder:text-muted"
        />
        {loading ? (
          <Loader2 size={18} className="animate-spin text-muted" />
        ) : q ? (
          <button onClick={() => setQ('')} className="text-muted hover:text-white">
            <X size={18} />
          </button>
        ) : (
          <kbd className="hidden rounded-md bg-white/10 px-2 py-0.5 text-xs font-bold text-muted lg:block">/</kbd>
        )}
      </div>
      {open && q.trim().length >= 2 && (
        <div className="animate-pop glass absolute inset-x-0 top-14 z-50 overflow-hidden rounded-3xl p-2 shadow-2xl ring-1 ring-white/10">
          {items.length === 0 && !loading && <div className="px-4 py-6 text-center text-sm text-muted">Ничего не нашлось</div>}
          {items.map((r, i) => (
            <button
              key={r.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(r)}
              onMouseEnter={() => setSel(i)}
              className={cn('flex w-full items-center gap-3 rounded-2xl p-2 text-left', i === sel && 'bg-white/10')}
            >
              <img src={posterUrl(r, 'thumbnail')} alt="" className="h-16 w-11 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0">
                <div className="truncate font-bold">{r.name.main}</div>
                <div className="truncate text-xs text-muted">{r.name.english}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs font-semibold text-white/60">
                  {r.type?.description} · {r.year}
                  {r.mal?.rating ? (
                    <span className="flex items-center gap-0.5">
                      <Star size={11} className="fill-yellow-400 text-yellow-400" /> {r.mal.rating.toFixed(1)}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          ))}
          {items.length > 0 && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false)
                nav(`/search?q=${encodeURIComponent(q.trim())}`)
              }}
              className="mt-1 w-full rounded-2xl py-2.5 text-sm font-bold text-accent-2 hover:bg-white/5"
            >
              Все результаты
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Header() {
  const nav = useNavigate()
  return (
    <header
      className={cn('drag sticky top-0 z-40 border-b border-white/[0.04] bg-bg/75 pb-3 backdrop-blur-2xl backdrop-saturate-150', isElectron && 'pr-[140px]')}
      style={{ paddingTop: 'max(var(--safe-top), 12px)' }}
    >
      <div className="flex items-center gap-3 px-4 sm:px-6 lg:gap-6 lg:px-10">
        <div className="hidden items-center gap-1 lg:flex">
          <button onClick={() => nav(-1)} className="no-drag flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-white">
            <ArrowLeft size={18} />
          </button>
          <button onClick={() => nav(1)} className="no-drag flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-white">
            <ArrowRight size={18} />
          </button>
        </div>
        <div className="shrink-0 lg:w-[200px]">
          <Logo />
        </div>
        <div className="hidden flex-1 justify-center md:flex">
          <SearchBox />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Link to="/search" className="no-drag flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 md:hidden">
            <Search size={20} />
          </Link>
          <SyncBadge />
          <Link to="/settings" className="no-drag flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
            <Settings size={20} />
          </Link>
        </div>
      </div>
    </header>
  )
}

function Sidebar() {
  return (
    <aside className="sticky top-[84px] hidden h-[calc(100vh-100px)] w-[250px] shrink-0 flex-col gap-2 overflow-y-auto pt-4 pb-6 pl-10 lg:flex">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-4 rounded-2xl border px-5 py-3.5 text-[15px] font-bold transition',
              isActive
                ? 'border-white/10 bg-white text-black shadow-lg shadow-white/5'
                : 'border-white/[0.06] bg-card/60 text-white/85 hover:border-white/10 hover:bg-card-2 hover:text-white',
            )
          }
        >
          <Icon size={22} strokeWidth={2.3} />
          {label}
        </NavLink>
      ))}
      <div className="mt-auto pt-6 text-xs leading-relaxed text-dim">
        Озвучка и видео — <span className="font-bold text-muted">AniLibria</span>.
        <br />
        Неофициальный клиент.
      </div>
    </aside>
  )
}

function TabBar() {
  return (
    <nav
      className="glass fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-white/5 px-2 pt-1.5 lg:hidden"
      style={{ paddingBottom: 'max(var(--safe-bottom), 8px)' }}
    >
      {TABS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn('flex min-w-[64px] flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-bold transition', isActive ? 'text-white' : 'text-dim')
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={23} strokeWidth={isActive ? 2.5 : 2} className={isActive ? 'text-accent-2' : ''} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const mainRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [loc.pathname])
  return (
    <div className="min-h-full" style={{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}>
      <Header />
      <div className="flex gap-8">
        <Sidebar />
        <main ref={mainRef} className="min-w-0 flex-1 px-4 pt-4 pb-28 sm:px-6 lg:pr-10 lg:pb-12 lg:pl-0">
          {children}
        </main>
      </div>
      <TabBar />
    </div>
  )
}
