import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import {
  Home,
  Magnet,
  LayoutGrid,
  CalendarDays,
  History,
  Library,
  BarChart3,
  Trophy,
  Award,
  Settings,
  Search,
  X,
  Cloud,
  CloudOff,
  Loader2,
  Star,
  ArrowLeft,
  ArrowRight,
  HardDriveDownload,
  BookOpen,
} from 'lucide-react'
import { api, posterUrl, type Release } from '../lib/api'
import { shiki, shImg, shikiTitle, shikiMeta, KINDS } from '../lib/shikimori'
import { groupByFranchise, franchiseName, partsWord } from '../lib/franchise'
import { useLibriaIndex } from '../lib/libriaIndex'
import { useSync } from '../lib/sync'
import { isElectron } from '../lib/platform'
import { UpdatePill } from './Updates'
import { MiniPlayer } from './Music'
import { RoomBridge, RoomButton } from './Room'
import { cn } from '../lib/format'
import { useStore } from '../lib/store'
import {
  Theme86SidebarMascot,
  Theme86FidoMascot,
  Theme86Petals,
  UndertakerMarkIcon,
  JuggernautIcon,
  LycorisIcon,
  RadarDishIcon,
  DogTagsIcon,
  SupplyDepotIcon,
  MagnoliaMedalIcon,
} from './Theme86Decorations'
import { CrashGuard } from './Crash'
import { Avatar } from './Social'
import { useMyProfile } from '../lib/social'
import { SUPPORT_URL } from '../lib/links'
import { AchievementToasts } from './AchievementToasts'
import { MiniProfile } from './MiniProfile'
import { DiscordBridge } from '../lib/discord'
import { WebInstall } from './WebInstall'
import { isWeb } from '../lib/platform'
import { Download } from 'lucide-react'
import { Dices, Sparkles } from 'lucide-react'

const NAV = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/catalog', label: 'Каталог', icon: LayoutGrid },
  { to: '/schedule', label: 'Расписание', icon: CalendarDays },
  { to: '/history', label: 'История', icon: History },
  { to: '/collection', label: 'Моя коллекция', icon: Library },
  { to: '/manga', label: 'Манга и ранобэ', icon: BookOpen },
  { to: '/stats', label: 'Статистика', icon: BarChart3 },
  { to: '/roulette', label: 'Аниме-рулетка', icon: Dices },
  { to: '/top', label: 'Топы', icon: Trophy },
  { to: '/achievements', label: 'Достижения', icon: Award },
  { to: '/downloads', label: 'Загрузки', icon: HardDriveDownload },
  // own torrents stream only in the desktop app
  ...(window.aniplayer?.torrent ? [{ to: '/torrent', label: 'Торрент-плеер', icon: Magnet }] : []),
]

const TABS = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/catalog', label: 'Каталог', icon: LayoutGrid },
  { to: '/search', label: 'Поиск', icon: Search },
  { to: '/manga', label: 'Манга', icon: BookOpen },
  { to: '/collection', label: 'Коллекция', icon: Library },
  { to: '/stats', label: 'Профиль', icon: BarChart3 },
]

export function Logo() {
  const theme = useStore((s) => s.local.theme)
  const is86 = theme === 'eightysix'
  return (
    <Link to="/" className="group no-drag flex items-center gap-2.5">
      <div className="relative">
        <img
          src="favicon.svg"
          alt=""
          className={cn(
            'h-10 w-10 drop-shadow-[0_6px_18px_var(--color-glow)] transition-all duration-300 group-hover:scale-105 group-hover:drop-shadow-[0_8px_24px_var(--color-glow)]',
            is86 && 'rounded-xl ring-1 ring-sky-400/50 shadow-[0_0_16px_rgba(56,189,248,0.35)]',
          )}
        />
        {is86 && (
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5" title="Para-RAID: Active">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 ring-1 ring-black" />
          </span>
        )}
      </div>
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5 leading-none">
          <span className="text-[22px] font-extrabold tracking-tight">
            any<span className="text-gradient">flow</span>
          </span>
          <span className="rounded border border-accent/40 bg-accent/15 px-1 py-0.5 text-[9px] font-black tracking-widest text-accent-2 uppercase shadow-[0_0_10px_var(--color-glow)]">
            LAB
          </span>
        </div>
        {is86 && (
          <span className="text-[9px] font-mono font-bold tracking-wider text-sky-300/80 uppercase">
            86 // SPEARHEAD
          </span>
        )}
      </div>
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

type QuickItem = { key: string; title: string; sub: string; poster: string; meta: string; rating: number | null; href: string; libria: boolean; mal?: number | null }

const fromRelease = (r: Release): QuickItem => ({
  key: `l${r.id}`,
  title: r.name.main,
  sub: r.name.english ?? '',
  poster: posterUrl(r, 'thumbnail'),
  meta: [r.type?.description, r.year].filter(Boolean).join(' · '),
  rating: r.mal?.rating ?? null,
  href: `/title/${r.alias}`,
  libria: true,
  mal: r.mal?.id,
})

function SearchBox() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<QuickItem[]>([])
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
      // Shikimori ranks every anime by popularity; AniLibria adds its own matches the catalog missed
      Promise.all([
        shiki.search(query, 8).catch(() => []),
        api.search(query).catch(() => [] as Release[]),
      ])
        .then(([sh, lib]) => {
          const byMal = useLibriaIndex.getState().byMal
          const out: QuickItem[] = sh.map((a) => {
            const l = byMal[a.id]
            return {
              key: `s${a.id}`,
              title: shikiTitle(a),
              sub: a.name,
              poster: shImg(a.image.preview),
              meta: [a.kind ? KINDS[a.kind] ?? a.kind : null, a.aired_on?.slice(0, 4)].filter(Boolean).join(' · '),
              rating: Number(a.score) || null,
              href: l ? `/title/${l.alias}` : `/anime/${a.id}`,
              libria: !!l,
              mal: a.id,
            }
          })
          const seen = new Set(sh.map((a) => a.id))
          for (const r of lib) if (!r.mal?.id || !seen.has(r.mal.id)) out.push(fromRelease(r))
          // every season of one anime is one line, under the anime's own name
          return shikiMeta(out.map((r) => r.mal ?? 0)).then((meta) => {
            const folded = groupByFranchise(out, (r) => r.mal, (r) => r.key, meta).map((parts) =>
              parts.length < 2
                ? parts[0]
                : { ...(parts.find((p) => p.libria) ?? parts[0]), title: franchiseName(parts.map((p) => p.title)), meta: [parts[0].meta, partsWord(parts.length)].filter(Boolean).join(' · ') },
            )
            setItems(folded.slice(0, 8))
            setSel(0)
          })
        })
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const go = (r: QuickItem) => {
    setOpen(false)
    setQ('')
    inputRef.current?.blur()
    nav(r.href)
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
          <>
            <Link to="/ai" title="Умный поиск: опишите, что хочется посмотреть" className="flex items-center gap-1 rounded-full bg-accent/20 px-2.5 py-1 text-xs font-extrabold text-accent-2 hover:bg-accent/30">
              <Sparkles size={13} /> ИИ
            </Link>
            <kbd className="hidden rounded-md bg-white/10 px-2 py-0.5 text-xs font-bold text-muted lg:block">/</kbd>
          </>
        )}
      </div>
      {open && q.trim().length >= 2 && (
        <div className="animate-pop glass absolute inset-x-0 top-14 z-50 overflow-hidden rounded-3xl p-2 shadow-2xl ring-1 ring-white/10">
          {q.trim().split(/\s+/).length >= 3 && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false)
                nav(`/ai?q=${encodeURIComponent(q.trim())}`)
              }}
              className="mb-1 flex w-full items-center gap-3 rounded-2xl bg-accent/15 p-3 text-left ring-1 ring-accent/30 hover:bg-accent/25"
            >
              <Sparkles size={18} className="shrink-0 text-accent-2" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-extrabold">Умный поиск с ИИ</span>
                <span className="block truncate text-xs text-white/60">Подобрать аниме по описанию: «{q.trim()}»</span>
              </span>
            </button>
          )}
          {items.length === 0 && !loading && <div className="px-4 py-6 text-center text-sm text-muted">Ничего не нашлось</div>}
          {items.map((r, i) => (
            <button
              key={r.key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(r)}
              onMouseEnter={() => setSel(i)}
              className={cn('flex w-full items-center gap-3 rounded-2xl p-2 text-left', i === sel && 'bg-white/10')}
            >
              <img src={r.poster} alt="" className="h-16 w-11 shrink-0 rounded-lg bg-card object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{r.title}</div>
                <div className="truncate text-xs text-muted">{r.sub}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs font-semibold text-white/60">
                  {r.meta}
                  {r.rating ? (
                    <span className="flex items-center gap-0.5">
                      <Star size={11} className="fill-yellow-400 text-yellow-400" /> {r.rating.toFixed(1)}
                    </span>
                  ) : null}
                </div>
              </div>
              {r.libria && <span className="shrink-0 rounded-lg bg-white px-2 py-0.5 text-[10px] font-extrabold text-black">AniLibria</span>}
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
  const theme = useStore((s) => s.local.theme)
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
        {theme === 'eightysix' && (
          <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-full bg-sky-950/50 border border-sky-400/30 text-[11px] font-mono tracking-wider text-sky-200 shadow-[0_0_15px_rgba(56,189,248,0.2)] animate-fade-in">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
            </span>
            <span className="font-bold text-sky-300">HANDLER ONE</span>
            <span className="text-white/30">|</span>
            <span className="text-slate-300">PARA-RAID: SYNC 100%</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Link to="/search" className="no-drag flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 md:hidden">
            <Search size={20} />
          </Link>
          {isWeb && (
            // the site's own page with the Android, Windows and iPad downloads
            <a
              href={new URL('../#download', location.href.split('#')[0]).href}
              className="no-drag flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-extrabold text-black transition hover:scale-[1.03]"
              title="Скачать приложение для Android, Windows и iPad"
            >
              <Download size={16} /> <span className="hidden sm:inline">Скачать приложение</span>
            </a>
          )}
          <UpdatePill />
          <RoomButton />
          <SyncBadge />
          <Link to="/settings" className="no-drag flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
            <Settings size={20} />
          </Link>
          <ProfileButton />
        </div>
      </div>
    </header>
  )
}

/** the signed-in user's avatar, leading to their profile */
function ProfileButton() {
  const me = useMyProfile()
  if (!me) return null
  return (
    <Link to={`/u/${me.username}`} title="Мой профиль" className="no-drag ml-1 rounded-full ring-2 ring-transparent transition hover:ring-accent-2">
      <Avatar p={me} size={36} />
    </Link>
  )
}


const CALLSIGNS: Record<string, string> = {
  '/': '[HQ-01]',
  '/catalog': '[RECON]',
  '/schedule': '[RADAR]',
  '/history': '[LOGS]',
  '/collection': '[DEPOT]',
  '/manga': '[LIB]',
  '/stats': '[SYNC]',
  '/roulette': '[DICE]',
  '/top': '[ACE]',
  '/achievements': '[MEDAL]',
  '/downloads': '[CACHE]',
  '/torrent': '[P2P]',
}

function Sidebar() {
  const theme = useStore((s) => s.local.theme)
  const is86 = theme === 'eightysix'
  return (
    <aside className="sticky top-[84px] hidden h-[calc(100vh-100px)] w-[250px] shrink-0 flex-col gap-2 overflow-y-auto pt-4 pb-6 pl-10 lg:flex">
      {NAV.map(({ to, label, icon: Icon }) => {
        const Custom86Icon = is86 && (
          to === '/' ? UndertakerMarkIcon :
          to === '/catalog' ? JuggernautIcon :
          to === '/schedule' ? RadarDishIcon :
          to === '/history' ? DogTagsIcon :
          to === '/collection' ? SupplyDepotIcon :
          to === '/manga' ? LycorisIcon :
          to === '/achievements' ? MagnoliaMedalIcon :
          null
        )
        const Tag = Custom86Icon || Icon
        return (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            data-nav=""
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3.5 rounded-2xl border px-4 py-3 text-[14px] font-bold transition group relative',
                isActive
                  ? 'border-white/10 bg-white text-black shadow-lg shadow-white/5'
                  : 'border-white/[0.06] bg-card/60 text-white/85 hover:border-white/10 hover:bg-card-2 hover:text-white',
                is86 && 'rounded-xl',
              )
            }
          >
            <Tag size={20} strokeWidth={2.3} className={cn(is86 && 'text-sky-300 group-hover:scale-110 transition-transform shrink-0')} />
            <span className="flex-1 truncate">{label}</span>
            {is86 && (
              <span className="text-[9px] font-mono text-sky-400/60 uppercase tracking-wider">
                {CALLSIGNS[to] ?? ''}
              </span>
            )}
          </NavLink>
        )
      })}
      {is86 && <Theme86SidebarMascot />}
      <div className="mt-auto flex flex-col gap-2 pt-6 text-xs leading-relaxed text-dim">
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-bold text-muted">
          <Link to="/about" className="hover:text-white">
            О приложении
          </Link>
          <Link to="/status" className="hover:text-white">
            Соединение
          </Link>
          <a href={SUPPORT_URL} target="_blank" rel="noreferrer" className="hover:text-white">
            Поддержка
          </a>
        </div>
        <div>
          Озвучка и видео — <span className="font-bold text-muted">AniLibria</span>.
          <br />
          Неофициальный клиент.
        </div>
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
  const theme = useStore((s) => s.local.theme)
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [loc.pathname])
  return (
    <div className="relative min-h-full" style={{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}>
      {/* a unique theme's illustration, behind everything */}
      <div className="theme-art" aria-hidden />
      {theme === 'eightysix' && (
        <>
          <Theme86Petals />
          <Theme86FidoMascot />
        </>
      )}
      <Header />
      <div className="flex gap-8">
        <Sidebar />
        <main ref={mainRef} className="min-w-0 flex-1 px-4 pt-4 pb-28 sm:px-6 lg:pr-10 lg:pb-12 lg:pl-0">
          {/* the next episode stays on the same page: a remount would drop fullscreen on every auto-next */}
          <CrashGuard key={loc.pathname.replace(/^(\/watch\/[^/]+)\/.*/, '$1')}>{children}</CrashGuard>
        </main>
      </div>
      <TabBar />
      <MiniPlayer />
      <RoomBridge />
      <AchievementToasts />
      <MiniProfile />
      <DiscordBridge />
      <WebInstall />
    </div>
  )
}
