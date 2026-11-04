// A person's card over the page: clicking someone in the top, a comment or a watch-together room shows
// their banner, level, favourite anime and rarest achievements without leaving the page.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { create } from 'zustand'
import { ShieldCheck, Trophy, X, Clock, Eye, CheckCircle2, Flame, UserX, Loader2 } from 'lucide-react'
import { Avatar } from './Social'
import { getProfile, profileStats, displayName, levelOf, type Profile, type ProfileStats } from '../lib/social'
import { shiki, shImg, shikiTitle, type ShikiAnime } from '../lib/shikimori'
import { RARITY, evaluate } from '../lib/achievements'
import { bannerCss, nameStyle, LinkChips } from './ProfileLook'

export const useMini = create<{ username: string | null }>(() => ({ username: null }))
export const openMini = (username: string) => useMini.setState({ username })

/** onClick for a link to `/u/name`: opens the card instead, a middle click still opens the page */
export const miniClick = (username: string) => (e: React.MouseEvent) => {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
  e.preventDefault()
  e.stopPropagation()
  openMini(username)
}

export function MiniProfile() {
  const username = useMini((s) => s.username)
  const close = () => useMini.setState({ username: null })
  useEffect(() => {
    if (!username) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [username])
  if (!username) return null
  return (
    <div className="animate-fade-in fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={close}>
      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] bg-card shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        <button onClick={close} className="absolute top-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur hover:bg-black/60" title="Закрыть">
          <X size={18} />
        </button>
        <Card key={username} username={username} onOpen={close} />
      </div>
    </div>
  )
}

function Card({ username, onOpen }: { username: string; onOpen: () => void }) {
  const [p, setP] = useState<Profile | null | undefined>(undefined)
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [favs, setFavs] = useState<ShikiAnime[]>([])
  const [err, setErr] = useState('')
  useEffect(() => {
    let on = true
    getProfile(username)
      .then((x) => {
        if (!on) return
        setP(x)
        if (!x) return
        void profileStats(x.id).then((s) => on && setStats(s)).catch(() => {})
        const ids = x.favorites.slice(0, 6)
        if (ids.length) void shiki.byIds(ids).then((l) => on && setFavs(ids.map((id) => l.find((a) => a.id === id)!).filter(Boolean)))
      })
      .catch((e: Error) => on && setErr(e.message))
    return () => {
      on = false
    }
  }, [username])

  if (err || p === null)
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <UserX className="text-muted" />
        <div className="font-extrabold">{err ? 'Не удалось открыть профиль' : 'Профиль скрыт или удалён'}</div>
        {err && <div className="text-sm text-muted">{err}</div>}
      </div>
    )
  if (!p)
    return (
      <div className="flex h-72 items-center justify-center">
        <Loader2 className="animate-spin text-muted" />
      </div>
    )

  const accent = p.accent ?? 'var(--color-accent)'
  const lvl = stats ? levelOf(stats.xp) : null
  const order = ['legendary', 'epic', 'rare', 'common']
  const rare = stats
    ? evaluate({ ...stats, created_at: p.created_at })
        .filter((x) => x.done)
        .sort((a, b) => order.indexOf(a.a.rarity) - order.indexOf(b.a.rarity))
        .slice(0, 4)
    : []
  return (
    <>
      <div className="h-28" style={{ background: p.banner_url ? `center / cover url("${p.banner_url}")` : bannerCss(p.banner_style, accent) }} />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <div className="-mt-10 flex items-end gap-3">
          <div className="rounded-full p-1" style={{ background: 'var(--color-card)' }}>
            <Avatar p={p} size={80} />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xl font-extrabold" style={nameStyle(p.name_style, accent)}>
                {displayName(p)}
              </span>
              {p.role !== 'user' && <ShieldCheck size={16} className="shrink-0 text-accent-2" />}
            </div>
            <div className="truncate text-xs font-semibold text-muted">@{p.username}</div>
          </div>
          {lvl && (
            <span className="mb-1 flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold text-black" style={{ background: accent }}>
              <Trophy size={12} /> {lvl.level} ур.
            </span>
          )}
        </div>
        {p.status && <div className="-mt-2 text-sm font-semibold text-white/85">{p.status}</div>}
        {p.bio && <p className="line-clamp-3 text-sm leading-relaxed text-white/70">{p.bio}</p>}

        {stats && (
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { i: <Clock size={15} />, v: `${Math.round(stats.seconds / 3600)} ч` },
              { i: <Eye size={15} />, v: stats.episodes },
              { i: <CheckCircle2 size={15} />, v: stats.completed },
              { i: <Flame size={15} />, v: stats.best_streak },
            ].map((s, k) => (
              <div key={k} className="rounded-2xl bg-white/[0.04] py-2 ring-1 ring-white/5" title={['часов просмотра', 'серий', 'аниме просмотрено', 'лучшая серия дней'][k]}>
                <div className="flex justify-center" style={{ color: accent }}>
                  {s.i}
                </div>
                <div className="text-sm font-extrabold">{s.v}</div>
              </div>
            ))}
          </div>
        )}

        {rare.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {rare.map(({ a }) => (
              <span key={a.id} title={a.hint} className="flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1.5 text-xs font-bold" style={{ background: `${RARITY[a.rarity].color}1f`, color: RARITY[a.rarity].color }}>
                <span className="text-base">{a.icon}</span> {a.label}
              </span>
            ))}
          </div>
        )}

        {favs.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-extrabold tracking-wide text-muted uppercase">Любимые аниме</div>
            <div className="grid grid-cols-6 gap-1.5">
              {favs.map((a) => (
                <Link key={a.id} to={`/anime/${a.id}`} onClick={onOpen} title={shikiTitle(a)}>
                  <img src={shImg(a.image.preview)} alt="" className="aspect-[2/3] w-full rounded-lg object-cover ring-1 ring-white/10 transition hover:scale-105" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {Object.keys(p.links ?? {}).length > 0 && <LinkChips links={p.links} />}

        <Link to={`/u/${p.username}`} onClick={onOpen} className="flex h-11 items-center justify-center rounded-full bg-white font-extrabold text-black transition hover:scale-[1.02]">
          Открыть профиль
        </Link>
      </div>
    </>
  )
}
