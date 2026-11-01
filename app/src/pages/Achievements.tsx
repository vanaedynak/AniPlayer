import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Award, Check, Lock, Palette as PaletteIcon, Search, UserX, X } from 'lucide-react'
import { Panel, PanelTitle, Empty, Skeleton } from '../components/ui'
import { getProfile, profileStats, useMyProfile, displayName, type Profile, type ProfileStats } from '../lib/social'
import { CATEGORIES, RARITY, evaluate, type Category, type Progress } from '../lib/achievements'
import { PALETTES } from '../lib/palettes'
import { useSync } from '../lib/sync'
import { useLocalMalEps, withLocal } from '../lib/myAchievements'
import { cn } from '../lib/format'

type Filter = 'all' | 'done' | 'todo'

/** every achievement, with progress: your own at /achievements, someone else's at /achievements/:username */
export default function Achievements() {
  const { username } = useParams()
  const me = useMyProfile()
  const user = useSync((s) => s.user)
  const [p, setP] = useState<Profile | null | undefined>(undefined)
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [params, setParams] = useSearchParams()
  const own = !username || username === me?.username
  const local = useLocalMalEps()

  useEffect(() => {
    let alive = true
    const load = async () => {
      const profile = username ? await getProfile(username) : me
      if (!alive) return
      setP(profile ?? null)
      if (profile) setStats(await profileStats(profile.id))
    }
    if (username || me) void load().catch(() => alive && setP(null))
    else if (!user) setP(null)
    return () => {
      alive = false
    }
  }, [username, me, user])

  // your own themed progress also counts what this device saw before the server did
  const list = useMemo(() => (stats && p ? evaluate(own ? withLocal({ ...stats, created_at: p.created_at }, local) : { ...stats, created_at: p.created_at }) : []), [stats, p, own, local])
  const opened = list.find((x) => x.a.id === params.get('a'))
  const open = (id: string | null) => setParams(id ? { a: id } : {}, { replace: !id })

  if (p === undefined || (p && !stats)) return <Skeleton className="mx-auto h-96 w-full max-w-5xl rounded-[28px]" />
  if (!p)
    return own ? (
      <Empty icon={<Award />} title="Достижения появятся после входа" text="Войдите в аккаунт в настройках: прогресс считает сервер." action={<Link to="/settings" className="rounded-full bg-white px-5 py-2.5 font-bold text-black">Войти</Link>} />
    ) : (
      <Empty icon={<UserX />} title="Профиль скрыт или не найден" />
    )

  const earned = list.filter((x) => x.done)
  const shown = list
    .filter((x) => cat === 'all' || x.a.category === cat)
    .filter((x) => !q.trim() || `${x.a.label} ${x.a.hint} ${x.a.anime ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    // others see only what was earned
    .filter((x) => (own ? (filter === 'done' ? x.done : filter === 'todo' ? !x.done : true) : x.done))
    .sort((a, b) => Number(b.done) - Number(a.done) || b.value / b.a.goal - a.value / a.a.goal)
  const pct = Math.round((earned.length / list.length) * 100)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Panel>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <PanelTitle icon={<Award className="text-accent-2" />} title={own ? 'Мои достижения' : `Достижения ${displayName(p)}`} sub={`${earned.length} из ${list.length} · ${pct}%`} />
          <div className="flex flex-1 flex-wrap gap-2 sm:justify-end">
            {(Object.keys(RARITY) as (keyof typeof RARITY)[]).map((r) => (
              <span key={r} className="flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1.5 text-xs font-bold ring-1 ring-white/5">
                <span className="h-2 w-2 rounded-full" style={{ background: RARITY[r].color }} />
                {RARITY[r].label} · {earned.filter((x) => x.a.rarity === r).length}/{list.filter((x) => x.a.rarity === r).length}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-accent to-pink" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {[{ id: 'all' as const, label: 'Все' }, ...CATEGORIES].map((c) => {
            const n = list.filter((x) => (c.id === 'all' || x.a.category === c.id) && x.done).length
            const total = list.filter((x) => c.id === 'all' || x.a.category === c.id).length
            return (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={cn('h-10 shrink-0 rounded-full px-4 text-sm font-bold ring-1 transition', cat === c.id ? 'bg-accent text-white ring-accent' : 'bg-white/[0.04] text-white/80 ring-white/5 hover:bg-white/[0.08]')}
              >
                {c.label} <span className="opacity-60">{n}/{total}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/[0.05] px-4 ring-1 ring-white/5 focus-within:ring-accent sm:max-w-xs">
          <Search size={16} className="shrink-0 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Наруто, Блич, 100 серий…" className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-muted" />
        </label>
        {own && (
          <div className="flex w-fit rounded-full bg-white/[0.05] p-1 ring-1 ring-white/5">
            {(
              [
                ['all', 'Все'],
                ['done', 'Получены'],
                ['todo', 'В процессе'],
              ] as [Filter, string][]
            ).map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)} className={cn('h-8 rounded-full px-4 text-sm font-bold', filter === id ? 'bg-white/15 text-white' : 'text-muted hover:text-white')}>
                {label}
              </button>
            ))}
          </div>
        )}
        </div>
      </Panel>

      {shown.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((x) => (
            <Card key={x.a.id} x={x} onOpen={() => open(x.a.id)} />
          ))}
        </div>
      ) : (
        <Empty icon={<Award />} title="Здесь пока пусто" text={q ? 'Ничего не нашлось.' : own ? 'Смотрите и читайте — достижения откроются сами.' : 'В этом разделе пока ничего не получено.'} />
      )}
      {opened && <Details x={opened} own={own} onClose={() => open(null)} />}
    </div>
  )
}

function Card({ x, onOpen }: { x: Progress; onOpen: () => void }) {
  const { a, value, done } = x
  const r = RARITY[a.rarity]
  const theme = a.reward && PALETTES.find((t) => t.id === a.reward!.theme)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className={cn('relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-3xl bg-card p-4 ring-1 transition hover:-translate-y-0.5 hover:bg-white/[0.06]', done ? 'ring-white/10' : 'ring-white/5')}
      style={done ? { boxShadow: `inset 0 0 0 1px ${r.color}55, 0 8px 30px -18px ${r.color}` } : undefined}
    >
      {done && <div className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full opacity-25 blur-2xl" style={{ background: r.color }} />}
      <div className="flex items-center gap-3">
        <span className={cn('relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-3xl', !done && 'grayscale')} style={{ background: done ? `${r.color}22` : 'rgba(255,255,255,0.04)', opacity: done ? 1 : 0.55 }}>
          {a.icon}
          {!done && (
            <span className="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 ring-1 ring-white/15">
              <Lock size={10} />
            </span>
          )}
        </span>
        <div className="min-w-0">
          <div className={cn('truncate font-extrabold', !done && 'text-white/60')}>{a.label}</div>
          <div className="truncate text-sm text-muted">{a.hint}</div>
          <div className="mt-0.5 text-[11px] font-extrabold tracking-wide uppercase" style={{ color: r.color }}>
            {r.label}
          </div>
        </div>
      </div>
      {!done && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / a.goal) * 100)}%`, background: r.color }} />
          </div>
          <span className="shrink-0 text-xs font-bold text-muted">
            {Math.min(value, a.goal).toLocaleString('ru')} / {a.goal.toLocaleString('ru')}
          </span>
        </div>
      )}
      {theme && (
        <Link to="/settings" onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-bold ring-1 ring-white/10 hover:bg-white/5" style={{ background: `linear-gradient(90deg, ${theme.accent}33, transparent)` }}>
          <PaletteIcon size={14} style={{ color: theme.light }} /> Награда: тема «{theme.label}» {done && '· открыта'}
        </Link>
      )}
    </div>
  )
}

/** one achievement up close: what it is about, how to get it, how far along you are */
function Details({ x, own, onClose }: { x: Progress; own: boolean; onClose: () => void }) {
  const { a, value, done } = x
  const r = RARITY[a.rarity]
  const theme = a.reward && PALETTES.find((t) => t.id === a.reward!.theme)
  const cat = CATEGORIES.find((c) => c.id === a.category)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="animate-fade-in fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-pop relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-card p-6 pb-[max(24px,var(--safe-bottom,0px))] ring-1 ring-white/10 sm:rounded-[28px]"
        style={{ boxShadow: done ? `inset 0 0 0 1px ${r.color}66, 0 30px 80px -30px ${r.color}` : undefined }}
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full opacity-30 blur-3xl" style={{ background: done ? r.color : '#ffffff22' }} />
        <button onClick={onClose} className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/15" aria-label="Закрыть">
          <X size={16} />
        </button>
        <div className="relative flex flex-col items-center text-center">
          <span className={cn('relative flex h-24 w-24 items-center justify-center rounded-[28px] text-6xl', !done && 'grayscale')} style={{ background: done ? `${r.color}26` : 'rgba(255,255,255,0.05)', opacity: done ? 1 : 0.6 }}>
            {a.icon}
            <span className="absolute -right-1.5 -bottom-1.5 flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-card" style={{ background: done ? r.color : '#1f2937' }}>
              {done ? <Check size={16} className="text-black" /> : <Lock size={14} />}
            </span>
          </span>
          <div className="mt-4 text-[11px] font-extrabold tracking-wide uppercase" style={{ color: r.color }}>
            {r.label} · {cat?.label}
          </div>
          <div className="mt-1 text-2xl font-extrabold">{a.label}</div>
          {a.anime && <div className="mt-1 text-sm font-bold text-white/70">{a.anime}</div>}
          {a.about && <p className="mt-4 text-[15px] leading-relaxed text-white/85">{a.about}</p>}
        </div>
        <div className="relative mt-5 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/5">
          <div className="text-xs font-bold text-muted">Как получить</div>
          <div className="mt-0.5 font-bold">{a.hint}</div>
          {own || done ? (
            <div className="mt-3 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / a.goal) * 100)}%`, background: r.color }} />
              </div>
              <span className="shrink-0 text-xs font-bold text-muted">{done ? 'Получено' : `${Math.min(value, a.goal).toLocaleString('ru')} / ${a.goal.toLocaleString('ru')}`}</span>
            </div>
          ) : null}
        </div>
        {theme && (
          <Link to="/settings" className="relative mt-3 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold ring-1 ring-white/10 hover:bg-white/5" style={{ background: `linear-gradient(90deg, ${theme.accent}33, transparent)` }}>
            <PaletteIcon size={16} style={{ color: theme.light }} /> Награда: тема «{theme.label}» {done && '· открыта'}
          </Link>
        )}
      </div>
    </div>
  )
}
