import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Award, Lock, Palette as PaletteIcon, UserX } from 'lucide-react'
import { Panel, PanelTitle, Empty, Skeleton } from '../components/ui'
import { getProfile, profileStats, useMyProfile, displayName, type Profile, type ProfileStats } from '../lib/social'
import { CATEGORIES, RARITY, evaluate, type Category, type Progress } from '../lib/achievements'
import { PALETTES } from '../lib/palettes'
import { useSync } from '../lib/sync'
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
  const own = !username || username === me?.username

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

  const list = useMemo(() => (stats && p ? evaluate({ ...stats, created_at: p.created_at }) : []), [stats, p])

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
        {own && (
          <div className="mt-3 flex w-fit rounded-full bg-white/[0.05] p-1 ring-1 ring-white/5">
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
      </Panel>

      {shown.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((x) => (
            <Card key={x.a.id} x={x} />
          ))}
        </div>
      ) : (
        <Empty icon={<Award />} title="Здесь пока пусто" text={own ? 'Смотрите и читайте — достижения откроются сами.' : 'В этом разделе пока ничего не получено.'} />
      )}
    </div>
  )
}

function Card({ x }: { x: Progress }) {
  const { a, value, done } = x
  const r = RARITY[a.rarity]
  const theme = a.reward && PALETTES.find((t) => t.id === a.reward!.theme)
  return (
    <div
      className={cn('relative flex flex-col gap-3 overflow-hidden rounded-3xl bg-card p-4 ring-1', done ? 'ring-white/10' : 'ring-white/5')}
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
        <Link to="/settings" className="flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-bold ring-1 ring-white/10 hover:bg-white/5" style={{ background: `linear-gradient(90deg, ${theme.accent}33, transparent)` }}>
          <PaletteIcon size={14} style={{ color: theme.light }} /> Награда: тема «{theme.label}» {done && '· открыта'}
        </Link>
      )}
    </div>
  )
}
