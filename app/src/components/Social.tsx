import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star, Heart, MessageCircle, Flag, Trash2, Pencil, EyeOff, Eye, Ban, Loader2, Send, ShieldCheck, X } from 'lucide-react'
import { useSync } from '../lib/sync'
import {
  animeScore,
  myScore,
  rate,
  listComments,
  postComment,
  editComment,
  deleteComment,
  toggleLike,
  reportComment,
  setHidden,
  banUser,
  useMyProfile,
  isStaff,
  displayName,
  type Comment,
  type CommentSort,
  type Profile,
} from '../lib/social'
import { cn, relTime } from '../lib/format'

export function Avatar({ p, size = 40, className }: { p?: Pick<Profile, 'username' | 'display_name' | 'avatar_url'> | null; size?: number; className?: string }) {
  const name = displayName(p)
  const [bad, setBad] = useState(false)
  return p?.avatar_url && !bad ? (
    <img src={p.avatar_url} alt="" onError={() => setBad(true)} className={cn('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />
  ) : (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-pink font-extrabold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** the users' average and the viewer's own score, 1 to 10 */
export function RatingBlock({ animeId }: { animeId: number }) {
  const user = useSync((s) => s.user)
  const [avg, setAvg] = useState<{ average: number; votes: number } | null>(null)
  const [mine, setMine] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    void animeScore(animeId).then(setAvg).catch(() => {})
    void myScore(animeId).then(setMine).catch(() => {})
  }, [animeId, user])

  const pick = async (n: number) => {
    setErr('')
    const next = n === mine ? null : n
    setMine(next)
    try {
      await rate(animeId, next)
      setAvg(await animeScore(animeId))
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const shown = hover ?? mine ?? 0
  return (
    <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-3xl bg-card p-5 ring-1 ring-white/5">
      <div className="flex items-center gap-3">
        <Star size={30} className="fill-yellow-400 text-yellow-400" />
        <div>
          <div className="text-2xl leading-none font-extrabold">{avg ? avg.average.toFixed(1) : '—'}</div>
          <div className="text-xs font-semibold text-muted">{avg ? `${avg.votes} ${plural(avg.votes, 'оценка', 'оценки', 'оценок')} в Anyflow` : 'пока без оценок'}</div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 text-sm font-bold">{user ? (mine ? `Ваша оценка: ${mine}` : 'Оцените тайтл') : 'Войдите, чтобы оценить'}</div>
        <div className="flex flex-wrap gap-1" onMouseLeave={() => setHover(null)}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              disabled={!user}
              onMouseEnter={() => setHover(n)}
              onClick={() => void pick(n)}
              className={cn(
                'h-9 w-9 rounded-xl text-sm font-extrabold transition disabled:opacity-40',
                n <= shown ? 'bg-yellow-400 text-black' : 'bg-white/[0.06] text-white/70 hover:bg-white/10',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        {err && <div className="mt-2 text-sm font-semibold text-rose-400">{err}</div>}
      </div>
    </section>
  )
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10
  const m100 = n % 100
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many
}

/** comments under a title: newest or best, replies one level deep */
export function Comments({ animeId }: { animeId: number }) {
  const user = useSync((s) => s.user)
  const me = useMyProfile()
  const [sort, setSort] = useState<CommentSort>('new')
  const [list, setList] = useState<Comment[] | null>(null)
  const [page, setPage] = useState(0)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setError('')
    listComments(animeId, sort, page)
      .then((r) => {
        if (!alive) return
        setList((cur) => (page ? [...(cur ?? []), ...r.items] : r.items))
        setMore(r.more)
      })
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
  }, [animeId, sort, page, user])

  const top = useMemo(() => (list ?? []).filter((c) => !c.parent_id), [list])
  const replies = (id: number) => (list ?? []).filter((c) => c.parent_id === id)
  const count = list?.length ?? 0
  const add = (c: Comment) => setList((cur) => (c.parent_id ? [...(cur ?? []), c] : [c, ...(cur ?? [])]))
  const change = (c: Comment) => setList((cur) => (cur ?? []).map((x) => (x.id === c.id ? c : x)))
  const remove = (id: number) => setList((cur) => (cur ?? []).filter((x) => x.id !== id && x.parent_id !== id))

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-2xl font-extrabold">
          <MessageCircle className="text-accent-2" /> Комментарии {count > 0 && <span className="text-base font-semibold text-muted">· {count}</span>}
        </h2>
        <div className="flex gap-1 rounded-full bg-card-2 p-1 ring-1 ring-white/5">
          {(['new', 'top'] as CommentSort[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                setSort(s)
                setPage(0)
              }}
              className={cn('rounded-full px-4 py-1.5 text-sm font-bold', sort === s ? 'bg-white text-black' : 'text-white/70 hover:text-white')}
            >
              {s === 'new' ? 'Новые' : 'Лучшие'}
            </button>
          ))}
        </div>
      </div>
      {user ? (
        <Composer animeId={animeId} me={me} onPosted={add} />
      ) : (
        <div className="mb-5 rounded-2xl bg-card p-4 text-sm font-semibold text-muted ring-1 ring-white/5">
          <Link to="/settings" className="font-bold text-accent-2">
            Войдите
          </Link>
          , чтобы писать комментарии и ставить лайки.
        </div>
      )}
      {error ? (
        <div className="text-sm font-semibold text-rose-400">{error}</div>
      ) : !list ? (
        <Loader2 className="mx-auto animate-spin text-muted" />
      ) : !top.length ? (
        <div className="py-8 text-center text-sm font-semibold text-muted">Пока никто ничего не написал — будьте первым.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {top.map((c) => (
            <div key={c.id}>
              <CommentItem c={c} me={me} animeId={animeId} onChange={change} onRemove={remove} onReply={add} />
              {replies(c.id).length > 0 && (
                <div className="mt-3 ml-6 flex flex-col gap-3 border-l border-white/10 pl-4 sm:ml-12">
                  {replies(c.id).map((r) => (
                    <CommentItem key={r.id} c={r} me={me} animeId={animeId} onChange={change} onRemove={remove} />
                  ))}
                </div>
              )}
            </div>
          ))}
          {more && (
            <button onClick={() => setPage((p) => p + 1)} className="self-center rounded-full bg-white/10 px-6 py-2.5 text-sm font-bold hover:bg-white/15">
              Показать ещё
            </button>
          )}
        </div>
      )}
      <div className="mt-4 text-xs text-dim">Без оскорблений, спама и ссылок. Спойлеры — под шторку. Нарушения скрываются.</div>
    </section>
  )
}

function Composer({ animeId, me, parentId, onPosted, onCancel, initial }: { animeId: number; me: Profile | null; parentId?: number; onPosted: (c: Comment) => void; onCancel?: () => void; initial?: string }) {
  const [text, setText] = useState(initial ?? '')
  const [spoiler, setSpoiler] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const banned = me?.banned_until && new Date(me.banned_until) > new Date()

  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    setErr('')
    try {
      onPosted(await postComment(animeId, text, spoiler, parentId ?? null))
      setText('')
      setSpoiler(false)
      onCancel?.()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (banned) return <div className="mb-5 rounded-2xl bg-rose-500/10 p-4 text-sm font-semibold text-rose-300">Вы не можете писать до {new Date(me!.banned_until!).toLocaleDateString('ru')}.</div>
  return (
    <div className={cn('flex gap-3', !parentId && 'mb-5')}>
      {!parentId && <Avatar p={me} />}
      <div className="min-w-0 flex-1">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 2000))}
          onKeyDown={(e) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey) ? void send() : undefined)}
          placeholder={parentId ? 'Ваш ответ…' : 'Что думаете об этом тайтле?'}
          rows={parentId ? 2 : 3}
          className="w-full resize-none rounded-2xl bg-card-2 px-4 py-3 text-[15px] ring-1 ring-white/5 outline-none placeholder:text-dim focus:ring-accent/60"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white/70">
            <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} className="accent-accent-2" /> Спойлер
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-dim tabular-nums">{text.length} / 2000</span>
            {onCancel && (
              <button onClick={onCancel} className="rounded-full px-4 py-2 text-sm font-bold text-white/70 hover:text-white">
                Отмена
              </button>
            )}
            <button onClick={() => void send()} disabled={!text.trim() || busy} className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-extrabold text-black disabled:opacity-40">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Отправить
            </button>
          </div>
        </div>
        {err && <div className="mt-2 text-sm font-semibold text-rose-400">{err}</div>}
      </div>
    </div>
  )
}

function CommentItem({ c, me, animeId, onChange, onRemove, onReply }: { c: Comment; me: Profile | null; animeId: number; onChange: (c: Comment) => void; onRemove: (id: number) => void; onReply?: (c: Comment) => void }) {
  const [open, setOpen] = useState(!c.spoiler)
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.body)
  const [err, setErr] = useState('')
  const [reported, setReported] = useState(false)
  const own = me?.id === c.user_id
  const staff = isStaff(me)
  const act = (f: () => Promise<unknown>) => () => {
    setErr('')
    f().catch((e) => setErr((e as Error).message))
  }

  return (
    <div className={cn('flex gap-3', c.hidden && 'opacity-50')}>
      <Link to={c.author ? `/u/${c.author.username}` : '#'}>
        <Avatar p={c.author} size={c.parent_id ? 32 : 40} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <Link to={c.author ? `/u/${c.author.username}` : '#'} className="font-extrabold hover:text-accent-2">
            {displayName(c.author)}
          </Link>
          {c.author && c.author.role !== 'user' && (
            <span className="flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-bold text-accent-2">
              <ShieldCheck size={11} /> {c.author.role === 'admin' ? 'админ' : 'модератор'}
            </span>
          )}
          <span className="text-xs font-semibold text-dim">
            {relTime(new Date(c.created_at).getTime())}
            {c.edited_at && ' · изменён'}
            {c.hidden && ' · скрыт'}
          </span>
        </div>
        {editing ? (
          <div className="mt-2">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 2000))} rows={3} className="w-full resize-none rounded-2xl bg-card-2 px-4 py-3 text-[15px] ring-1 ring-white/10 outline-none" />
            <div className="mt-2 flex gap-2">
              <button
                onClick={act(async () => {
                  await editComment(c.id, draft, c.spoiler)
                  onChange({ ...c, body: draft.trim(), edited_at: new Date().toISOString() })
                  setEditing(false)
                })}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black"
              >
                Сохранить
              </button>
              <button onClick={() => setEditing(false)} className="rounded-full px-4 py-1.5 text-sm font-bold text-white/70">
                Отмена
              </button>
            </div>
          </div>
        ) : open ? (
          <p className="mt-1 text-[15px] leading-relaxed break-words whitespace-pre-line text-white/90">{c.body}</p>
        ) : (
          <button onClick={() => setOpen(true)} className="mt-1.5 rounded-xl bg-white/[0.06] px-4 py-2 text-sm font-bold text-white/70 hover:bg-white/10">
            Спойлер — нажмите, чтобы прочитать
          </button>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs font-bold text-muted">
          <button
            onClick={act(async () => {
              await toggleLike(c)
              onChange({ ...c, liked: !c.liked, likes: c.likes + (c.liked ? -1 : 1) })
            })}
            disabled={!me || own}
            className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 hover:bg-white/5 disabled:hover:bg-transparent', c.liked && 'text-pink')}
          >
            <Heart size={14} className={c.liked ? 'fill-current' : undefined} /> {c.likes || ''}
          </button>
          {onReply && me && (
            <button onClick={() => setReplying((v) => !v)} className="rounded-full px-2.5 py-1 hover:bg-white/5">
              Ответить
            </button>
          )}
          {own && !editing && (
            <button onClick={() => setEditing(true)} title="Изменить" className="rounded-full p-1.5 hover:bg-white/5">
              <Pencil size={13} />
            </button>
          )}
          {(own || staff) && (
            <button
              onClick={act(async () => {
                if (!confirm('Удалить комментарий?')) return
                await deleteComment(c.id)
                onRemove(c.id)
              })}
              title="Удалить"
              className="rounded-full p-1.5 hover:bg-white/5"
            >
              <Trash2 size={13} />
            </button>
          )}
          {me && !own && !reported && (
            <button
              onClick={act(async () => {
                const reason = prompt('Что не так с комментарием? (оскорбление, спам, спойлер…)')
                if (!reason?.trim()) return
                await reportComment(c.id, reason)
                setReported(true)
              })}
              title="Пожаловаться"
              className="rounded-full p-1.5 hover:bg-white/5"
            >
              <Flag size={13} />
            </button>
          )}
          {reported && <span className="px-2 text-dim">Жалоба отправлена</span>}
          {staff && !own && (
            <>
              <button
                onClick={act(async () => {
                  await setHidden(c.id, !c.hidden)
                  onChange({ ...c, hidden: !c.hidden })
                })}
                title={c.hidden ? 'Вернуть' : 'Скрыть'}
                className="rounded-full p-1.5 text-amber-300 hover:bg-white/5"
              >
                {c.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              <button
                onClick={act(async () => {
                  const days = Number(prompt('Заблокировать на сколько дней? (0 — снять блок)', '7'))
                  if (Number.isFinite(days) && days >= 0) await banUser(c.user_id, days)
                })}
                title="Заблокировать автора"
                className="rounded-full p-1.5 text-rose-300 hover:bg-white/5"
              >
                <Ban size={13} />
              </button>
            </>
          )}
        </div>
        {err && (
          <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-rose-400">
            {err}
            <button onClick={() => setErr('')}>
              <X size={12} />
            </button>
          </div>
        )}
        {replying && onReply && (
          <div className="mt-3">
            <Composer animeId={animeId} me={me} parentId={c.id} onPosted={onReply} onCancel={() => setReplying(false)} />
          </div>
        )}
      </div>
    </div>
  )
}
