import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, Check, EyeOff, Ban, Trash2, Loader2 } from 'lucide-react'
import { Panel, PanelTitle, Empty } from '../components/ui'
import { Avatar } from '../components/Social'
import { listReports, clearReports, setHidden, banUser, deleteComment, useMyProfile, isStaff, displayName, type Report } from '../lib/social'
import { relTime } from '../lib/format'

/** reported comments for moderators: keep, hide, delete or ban the author */
export default function Moderation() {
  const me = useMyProfile()
  const [list, setList] = useState<Report[] | null>(null)
  const [err, setErr] = useState('')

  const load = () =>
    listReports()
      .then(setList)
      .catch((e) => setErr((e as Error).message))
  useEffect(() => {
    if (isStaff(me)) void load()
  }, [me])

  if (!isStaff(me)) return <Empty icon={<ShieldCheck />} title="Только для модераторов" />
  // one card per comment, with every reason people gave
  const byComment = new Map<number, Report[]>()
  for (const r of list ?? []) byComment.set(r.comment_id, [...(byComment.get(r.comment_id) ?? []), r])
  const act = (f: () => Promise<unknown>) => () => f().then(load).catch((e) => setErr((e as Error).message))

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Panel>
        <PanelTitle icon={<ShieldCheck className="text-accent-2" />} title="Жалобы" sub="Комментарий с тремя жалобами скрывается сам, пока вы его не проверите" />
        {err && <div className="mb-3 text-sm font-semibold text-rose-400">{err}</div>}
        {!list ? (
          <Loader2 className="mx-auto animate-spin text-muted" />
        ) : !byComment.size ? (
          <div className="py-6 text-center font-semibold text-muted">Жалоб нет</div>
        ) : (
          <div className="flex flex-col gap-4">
            {[...byComment.entries()].map(([id, reports]) => {
              const c = reports[0].comment
              if (!c) return null
              return (
                <div key={id} className="rounded-2xl bg-white/[0.04] p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <Avatar p={c.author} size={28} />
                    <Link to={`/u/${c.author?.username}`} className="font-extrabold">
                      {displayName(c.author)}
                    </Link>
                    <span className="text-xs text-dim">{relTime(new Date(c.created_at).getTime())}</span>
                    {c.hidden && <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-bold text-amber-300">скрыт</span>}
                    <Link to={`/anime/${c.anime_id}`} className="ml-auto text-xs font-bold text-accent-2">
                      к тайтлу
                    </Link>
                  </div>
                  <p className="text-[15px] whitespace-pre-line">{c.body}</p>
                  <div className="mt-2 text-xs font-semibold text-muted">
                    {reports.length} {reports.length === 1 ? 'жалоба' : 'жалобы'}: {reports.map((r) => r.reason).join(' · ')}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={act(async () => (await setHidden(id, false), await clearReports(id)))} className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-bold">
                      <Check size={14} /> Всё в порядке
                    </button>
                    <button onClick={act(async () => (await setHidden(id, true), await clearReports(id)))} className="flex items-center gap-1.5 rounded-full bg-amber-400/15 px-4 py-2 text-sm font-bold text-amber-300">
                      <EyeOff size={14} /> Скрыть
                    </button>
                    <button onClick={act(() => deleteComment(id))} className="flex items-center gap-1.5 rounded-full bg-rose-500/15 px-4 py-2 text-sm font-bold text-rose-300">
                      <Trash2 size={14} /> Удалить
                    </button>
                    <button
                      onClick={act(async () => {
                        const days = Number(prompt('Заблокировать автора на сколько дней?', '7'))
                        if (Number.isFinite(days) && days > 0) await banUser(c.user_id, days)
                      })}
                      className="flex items-center gap-1.5 rounded-full bg-rose-500/15 px-4 py-2 text-sm font-bold text-rose-300"
                    >
                      <Ban size={14} /> Бан автору
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </div>
  )
}
