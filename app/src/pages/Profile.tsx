import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Pencil, Camera, Lock, Clock, CheckCircle2, Eye, MessageCircle, Star, Loader2, ShieldCheck, UserX, Heart } from 'lucide-react'
import { Panel, Empty, Skeleton, ShikiCard } from '../components/ui'
import { Avatar } from '../components/Social'
import { getProfile, profileStats, updateProfile, uploadPicture, userComments, useMyProfile, displayName, type Profile, type ProfileStats, type Comment } from '../lib/social'
import { shiki, type ShikiAnime } from '../lib/shikimori'
import { useStore } from '../lib/store'
import { useSync } from '../lib/sync'
import { cn, relTime } from '../lib/format'

const ACCENTS = ['#14b8a6', '#38bdf8', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#22c55e', '#f43f5e']

/** a user's public page: avatar, banner, about, favorites, watching stats and latest comments */
export default function ProfilePage() {
  const { username = '' } = useParams()
  const me = useMyProfile()
  const [p, setP] = useState<Profile | null | undefined>(undefined)
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [favs, setFavs] = useState<ShikiAnime[]>([])
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setP(undefined)
    getProfile(username)
      .then((x) => {
        if (!alive) return
        setP(x)
        if (!x) return
        void profileStats(x.id).then((s) => alive && setStats(s)).catch(() => {})
        void userComments(x.id).then((c) => alive && setComments(c)).catch(() => {})
        if (x.favorites.length) void shiki.byIds(x.favorites).then((list) => alive && setFavs(x.favorites.map((id) => list.find((a) => a.id === id)!).filter(Boolean)))
        else setFavs([])
      })
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
  }, [username])

  if (error) return <Empty icon={<UserX />} title="Не удалось открыть профиль" text={error} />
  if (p === undefined) return <Skeleton className="h-72 w-full rounded-[32px]" />
  if (p === null) return <Empty icon={<UserX />} title="Такого пользователя нет" text="Или он скрыл свой профиль." />

  const own = me?.id === p.id
  const accent = p.accent ?? 'var(--color-accent)'
  const hours = stats ? Math.round(stats.seconds / 360) / 10 : 0
  const banned = p.banned_until && new Date(p.banned_until) > new Date()

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="relative overflow-hidden rounded-[32px] bg-card ring-1 ring-white/5">
        <div className="h-40 sm:h-56" style={{ background: p.banner_url ? `center / cover url("${p.banner_url}")` : `linear-gradient(120deg, ${accent}, var(--color-pink))` }} />
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end sm:px-8">
          <div className="-mt-14 rounded-full p-1.5" style={{ background: 'var(--color-card)' }}>
            <Avatar p={p} size={112} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-extrabold tracking-tight">{displayName(p)}</h1>
              {p.role !== 'user' && (
                <span className="flex items-center gap-1 rounded-full bg-accent/20 px-2.5 py-0.5 text-xs font-bold text-accent-2">
                  <ShieldCheck size={13} /> {p.role === 'admin' ? 'Администратор' : 'Модератор'}
                </span>
              )}
              {!p.public && (
                <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold">
                  <Lock size={12} /> Скрытый профиль
                </span>
              )}
              {banned && <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-bold text-rose-300">Заблокирован</span>}
            </div>
            <div className="text-sm font-semibold text-muted">
              @{p.username} · с нами с {new Date(p.created_at).toLocaleDateString('ru', { month: 'long', year: 'numeric' })}
            </div>
          </div>
          {own && (
            <button onClick={() => setEditing((v) => !v)} className="flex h-11 items-center gap-2 self-start rounded-full bg-white/10 px-5 font-bold hover:bg-white/15 sm:self-end">
              <Pencil size={16} /> {editing ? 'Готово' : 'Редактировать'}
            </button>
          )}
        </div>
        {p.bio && !editing && <p className="px-6 pb-6 text-[15px] leading-relaxed whitespace-pre-line text-white/80 sm:px-8">{p.bio}</p>}
      </div>

      {editing && own && <EditProfile p={p} onSaved={(np) => setP(np)} />}

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { icon: <Clock size={18} />, v: `${hours} ч`, l: 'просмотра' },
            { icon: <Eye size={18} />, v: stats.episodes, l: 'серий' },
            { icon: <CheckCircle2 size={18} />, v: stats.completed, l: 'просмотрено' },
            { icon: <Heart size={18} />, v: stats.watching, l: 'смотрит' },
            { icon: <Star size={18} />, v: stats.ratings, l: 'оценок' },
            { icon: <MessageCircle size={18} />, v: stats.comments, l: 'комментариев' },
          ].map((s) => (
            <div key={s.l} className="rounded-3xl bg-card p-4 ring-1 ring-white/5">
              <div className="mb-2" style={{ color: accent }}>
                {s.icon}
              </div>
              <div className="text-2xl font-extrabold">{s.v}</div>
              <div className="text-xs font-semibold text-muted">{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {favs.length > 0 && (
        <Panel>
          <div className="mb-4 text-xl font-extrabold">Любимые аниме</div>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {favs.map((a) => (
              <ShikiCard key={a.id} a={a} />
            ))}
          </div>
        </Panel>
      )}

      {comments.length > 0 && (
        <Panel>
          <div className="mb-4 text-xl font-extrabold">Последние комментарии</div>
          <div className="flex flex-col divide-y divide-white/5">
            {comments.map((c) => (
              <Link key={c.id} to={`/anime/${c.anime_id}`} className="py-3 hover:text-accent-2">
                <div className="line-clamp-2 text-[15px]">{c.spoiler ? 'Спойлер' : c.body}</div>
                <div className="text-xs font-semibold text-dim">{relTime(new Date(c.created_at).getTime())}</div>
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

function EditProfile({ p, onSaved }: { p: Profile; onSaved: (p: Profile) => void }) {
  const titles = useStore((s) => s.titles)
  const [form, setForm] = useState({ display_name: p.display_name ?? '', bio: p.bio ?? '', accent: p.accent ?? '', public: p.public, favorites: p.favorites })
  const [busy, setBusy] = useState<'' | 'save' | 'avatar' | 'banner'>('')
  const [msg, setMsg] = useState('')
  const avatarIn = useRef<HTMLInputElement>(null)
  const bannerIn = useRef<HTMLInputElement>(null)
  // favorites are picked from the user's own list
  const candidates = Object.values(titles)
    .filter((t) => t.malId && (t.status === 'completed' || t.status === 'watching' || t.favorite))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 60)

  const save = async () => {
    setBusy('save')
    setMsg('')
    try {
      const patch = { display_name: form.display_name.trim() || null, bio: form.bio.trim() || null, accent: form.accent || null, public: form.public, favorites: form.favorites }
      await updateProfile(patch)
      onSaved({ ...p, ...patch })
      setMsg('Сохранено')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const upload = async (file: File | undefined, kind: 'avatar' | 'banner') => {
    if (!file) return
    setBusy(kind)
    setMsg('')
    try {
      const url = await uploadPicture(file, kind)
      await updateProfile(kind === 'avatar' ? { avatar_url: url } : { banner_url: url })
      onSaved({ ...p, ...(kind === 'avatar' ? { avatar_url: url } : { banner_url: url }) })
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const input = 'w-full rounded-2xl bg-card-2 px-4 py-3 font-semibold ring-1 ring-white/5 outline-none focus:ring-accent/60'
  return (
    <Panel>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          <input ref={avatarIn} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void upload(e.target.files?.[0], 'avatar')} />
          <input ref={bannerIn} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void upload(e.target.files?.[0], 'banner')} />
          <button onClick={() => avatarIn.current?.click()} className="flex h-11 items-center gap-2 rounded-full bg-white/10 px-5 font-bold hover:bg-white/15">
            {busy === 'avatar' ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} Аватар
          </button>
          <button onClick={() => bannerIn.current?.click()} className="flex h-11 items-center gap-2 rounded-full bg-white/10 px-5 font-bold hover:bg-white/15">
            {busy === 'banner' ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} Обложка
          </button>
          <span className="self-center text-xs text-dim">PNG, JPG, WebP или GIF до 2 МБ</span>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold">Имя на сайте</span>
          <input className={input} maxLength={40} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder={p.username} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold">О себе</span>
          <textarea className={cn(input, 'resize-none')} rows={3} maxLength={500} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="Что любите смотреть, любимые жанры…" />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold">Цвет профиля</span>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((c) => (
              <button key={c} onClick={() => setForm({ ...form, accent: c })} className={cn('h-9 w-9 rounded-full ring-2', form.accent === c ? 'ring-white' : 'ring-transparent')} style={{ background: c }} />
            ))}
          </div>
        </div>
        {candidates.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-bold">Любимые аниме · {form.favorites.length} из 12</span>
            <div className="flex flex-wrap gap-2">
              {candidates.map((t) => {
                const on = form.favorites.includes(t.malId!)
                return (
                  <button
                    key={t.releaseId}
                    onClick={() =>
                      setForm({ ...form, favorites: on ? form.favorites.filter((x) => x !== t.malId) : form.favorites.length < 12 ? [...form.favorites, t.malId!] : form.favorites })
                    }
                    className={cn('rounded-full px-3 py-1.5 text-sm font-bold ring-1', on ? 'bg-accent text-white ring-accent' : 'ring-white/10 hover:bg-white/5')}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
          <span>
            <span className="block font-bold">Открытый профиль</span>
            <span className="text-sm text-muted">Другие видят статистику, любимые аниме и комментарии</span>
          </span>
          <input type="checkbox" checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} className="h-5 w-5 accent-accent-2" />
        </label>
        <div className="flex items-center gap-3">
          <button onClick={() => void save()} disabled={!!busy} className="h-12 rounded-full bg-white px-7 font-extrabold text-black disabled:opacity-50">
            {busy === 'save' ? <Loader2 className="animate-spin" /> : 'Сохранить'}
          </button>
          {msg && <span className={cn('text-sm font-semibold', msg === 'Сохранено' ? 'text-emerald-400' : 'text-rose-400')}>{msg}</span>}
        </div>
      </div>
    </Panel>
  )
}

/** "Мой профиль" for the header and settings */
export function useMyProfileLink() {
  const user = useSync((s) => s.user)
  const me = useMyProfile()
  return user && me ? `/u/${me.username}` : null
}
