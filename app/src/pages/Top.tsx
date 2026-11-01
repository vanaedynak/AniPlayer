import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Clock, Tv, BookOpen, BookText, Glasses, Flame, Crown, Heart, Star, Sparkles, Info, AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Panel, PanelTitle, Empty, Skeleton } from '../components/ui'
import { Avatar } from '../components/Social'
import { leaderboard, displayName, type Board, type Period, type Place } from '../lib/social'
import { useSync } from '../lib/sync'
import { cn } from '../lib/format'

const BOARDS: { id: Board; label: string; icon: ReactNode; unit: (v: number) => string; hint: string }[] = [
  { id: 'xp', label: 'Общий зачёт', icon: <Sparkles size={16} />, unit: (v) => `${v.toLocaleString('ru')} XP`, hint: 'Опыт за всё: минута просмотра или чтения — 1, серия — 5, глава манги — 2, глава ранобэ — 4' },
  { id: 'watch', label: 'Часы просмотра', icon: <Clock size={16} />, unit: hours, hint: 'Время, которое реально играло видео' },
  { id: 'episodes', label: 'Серии', icon: <Tv size={16} />, unit: (v) => plural(v, 'серия', 'серии', 'серий'), hint: 'Досмотренные серии' },
  { id: 'chapters', label: 'Манга', icon: <BookOpen size={16} />, unit: (v) => plural(v, 'глава', 'главы', 'глав'), hint: 'Дочитанные до последней страницы главы манги' },
  { id: 'ln', label: 'Ранобэ', icon: <BookText size={16} />, unit: (v) => plural(v, 'глава', 'главы', 'глав'), hint: 'Дочитанные главы ранобэ' },
  { id: 'read', label: 'Время чтения', icon: <Glasses size={16} />, unit: hours, hint: 'Время в читалках манги и ранобэ, пока вы листаете' },
  { id: 'streak', label: 'Серия дней', icon: <Flame size={16} />, unit: (v) => plural(v, 'день', 'дня', 'дней'), hint: 'Дней подряд хотя бы с 10 минутами просмотра или чтения' },
  { id: 'best_streak', label: 'Рекорд серии', icon: <Crown size={16} />, unit: (v) => plural(v, 'день', 'дня', 'дней'), hint: 'Самая длинная серия дней' },
  { id: 'likes', label: 'Комментаторы', icon: <Heart size={16} />, unit: (v) => plural(v, 'лайк', 'лайка', 'лайков'), hint: 'Лайки, собранные комментариями' },
  { id: 'critic', label: 'Критики', icon: <Star size={16} />, unit: (v) => plural(v, 'оценка', 'оценки', 'оценок'), hint: 'Сколько аниме оценено' },
]
const PERIODS: { id: Period; label: string }[] = [
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'all', label: 'Всё время' },
]
const MEDALS = ['#facc15', '#cbd5e1', '#f59e0b']

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
  return `${n.toLocaleString('ru')} ${w}`
}
function hours(s: number) {
  return s < 3600 ? `${Math.round(s / 60)} мин` : `${(Math.round(s / 360) / 10).toLocaleString('ru')} ч`
}

/** leaderboards: hours, episodes, chapters, streaks and more, counted by the server so nobody can cheat their way up */
export default function Top() {
  const [board, setBoard] = useState<Board>('xp')
  const [period, setPeriod] = useState<Period>('week')
  const [rows, setRows] = useState<Place[] | null>(null)
  const [error, setError] = useState('')
  const user = useSync((s) => s.user)
  const b = BOARDS.find((x) => x.id === board)!
  const timeless = board === 'streak' || board === 'best_streak'

  useEffect(() => {
    let alive = true
    setRows(null)
    setError('')
    leaderboard(board, timeless ? 'all' : period)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
  }, [board, period, timeless, user?.id])

  const top = rows?.filter((r) => r.place <= 50) ?? []
  const mine = rows?.find((r) => r.me)
  const podium = top.slice(0, 3)
  const rest = top.slice(3)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Panel>
        <PanelTitle icon={<Trophy className="text-accent-2" />} title="Топы" sub="Считает сервер по реальному времени — накрутить нельзя" />
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {BOARDS.map((x) => (
            <button
              key={x.id}
              onClick={() => setBoard(x.id)}
              className={cn(
                'flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-bold ring-1 transition',
                board === x.id ? 'bg-accent text-white ring-accent' : 'bg-white/[0.04] text-white/80 ring-white/5 hover:bg-white/[0.08]',
              )}
            >
              {x.icon} {x.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-muted">{b.hint}</div>
          {!timeless && (
            <div className="flex rounded-full bg-white/[0.05] p-1 ring-1 ring-white/5">
              {PERIODS.map((x) => (
                <button
                  key={x.id}
                  onClick={() => setPeriod(x.id)}
                  className={cn('h-8 rounded-full px-4 text-sm font-bold transition', period === x.id ? 'bg-white/15 text-white' : 'text-muted hover:text-white')}
                >
                  {x.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </Panel>

      {error ? (
        <Empty icon={<AlertCircle />} title="Топ не загрузился" text={error} />
      ) : !rows ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-44 w-full rounded-[28px]" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !top.length ? (
        <Empty
          icon={b.icon}
          title="Пока никого"
          text={user ? 'Станьте первым — смотрите и читайте, место появится само.' : 'Войдите в аккаунт в настройках, чтобы попасть в топ.'}
        />
      ) : (
        <>
          <div className="grid grid-cols-3 items-end gap-2 sm:gap-4">
            {[podium[1], podium[0], podium[2]].map((r, i) =>
              r ? <PodiumCard key={r.user_id} r={r} unit={b.unit} first={i === 1} /> : <div key={i} />,
            )}
          </div>
          {rest.length > 0 && (
            <div className="flex flex-col gap-2">
              {rest.map((r) => (
                <Row key={r.user_id} r={r} unit={b.unit} />
              ))}
            </div>
          )}
          {mine && mine.place > 50 && (
            <div className="sticky bottom-24 z-10 lg:bottom-4">
              <Row r={mine} unit={b.unit} />
            </div>
          )}
          {!mine && (
            <div className="rounded-2xl bg-white/[0.04] px-5 py-4 text-sm font-semibold text-muted ring-1 ring-white/5">
              {user ? 'Вас пока нет в этом топе.' : 'Войдите в аккаунт в настройках, чтобы попасть в топ.'}
            </div>
          )}
        </>
      )}

      <details className="rounded-2xl bg-white/[0.03] px-5 py-4 text-sm text-white/75 ring-1 ring-white/5">
        <summary className="flex cursor-pointer items-center gap-2 font-bold text-white">
          <Info size={16} /> Почему топ честный
        </summary>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5">
          <li>Время засчитывает сервер: за час можно получить не больше часа, даже если подделать приложение.</li>
          <li>Не больше 16 часов в сутки, и только за последние два дня — задним числом ничего не добавить.</li>
          <li>Серия засчитывается, только если перед этим реально было 8 минут просмотра; глава манги — 15 секунд чтения, глава ранобэ — 45.</li>
          <li>Одна и та же глава или серия на устройстве считается один раз.</li>
          <li>Время чтения идёт, пока вы листаете; если 1,5 минуты ничего не происходит, отсчёт останавливается.</li>
          <li>В топе только открытые профили; скрытый профиль видит своё место, но другим он не показан.</li>
          <li>История, перенесённая со старого аккаунта, видна в статистике, но в топах не участвует.</li>
        </ul>
      </details>
    </div>
  )
}

function PodiumCard({ r, unit, first }: { r: Place; unit: (v: number) => string; first: boolean }) {
  const color = MEDALS[r.place - 1] ?? 'var(--color-accent)'
  return (
    <Link
      to={`/u/${r.username}`}
      className={cn(
        'flex min-w-0 flex-col items-center gap-2 rounded-[28px] bg-card px-2 text-center ring-1 transition hover:bg-card-2',
        first ? 'pt-6 pb-6' : 'pt-5 pb-4',
        r.me ? 'ring-accent' : 'ring-white/5',
      )}
      style={{ boxShadow: `inset 0 3px 0 ${color}` }}
    >
      <div className="relative">
        <Avatar p={r} size={first ? 84 : 64} />
        <span className="absolute -right-1 -bottom-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold text-black ring-4 ring-[var(--color-card)]" style={{ background: color }}>
          {r.place}
        </span>
      </div>
      <div className="w-full truncate px-1 font-extrabold">{displayName(r)}</div>
      <div className="text-xs font-bold sm:text-sm" style={{ color }}>
        {unit(r.value)}
      </div>
    </Link>
  )
}

function Row({ r, unit }: { r: Place; unit: (v: number) => string }) {
  return (
    <Link
      to={`/u/${r.username}`}
      className={cn('flex items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 transition hover:bg-card-2', r.me ? 'ring-accent' : 'ring-white/5')}
    >
      <span className="w-8 text-center text-lg font-extrabold text-muted">{r.place}</span>
      <Avatar p={r} size={40} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">
          {displayName(r)} {r.me && <span className="text-xs font-bold text-accent-2">· вы</span>}
        </div>
        <div className="truncate text-xs font-semibold text-muted">@{r.username}</div>
      </div>
      <span className="shrink-0 font-extrabold" style={{ color: r.accent ?? undefined }}>
        {unit(r.value)}
      </span>
    </Link>
  )
}
