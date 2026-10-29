import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { ReleaseCard, CardSkeletons, Chip } from '../components/ui'
import { fmtOrdinal } from '../lib/format'

const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']

export default function Schedule() {
  const { data, loading } = useAsync(() => api.scheduleWeek(), [])
  const today = (new Date().getDay() + 6) % 7
  const [day, setDay] = useState(today)
  const byDay = useMemo(() => {
    const m: Record<number, NonNullable<typeof data>> = {}
    for (const s of data ?? []) {
      const d = Number(s.release.publish_day?.value ?? 0) - 1
      ;(m[d] ??= []).push(s)
    }
    return m
  }, [data])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Расписание</h1>
        <div className="mt-1 text-sm font-semibold text-muted">Когда AniLibria выпускает новые серии онгоингов</div>
      </div>
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {DAYS.map((d, i) => (
          <Chip key={d} active={i === day} onClick={() => setDay(i)}>
            {d}
            {i === today ? ' · сегодня' : ''}
            {byDay[i]?.length ? <span className="ml-1.5 opacity-50">{byDay[i].length}</span> : null}
          </Chip>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {loading ? (
          <CardSkeletons n={10} />
        ) : (
          (byDay[day] ?? []).map((s) => (
            <ReleaseCard
              key={s.release.id}
              r={s.release}
              sub={
                s.next_release_episode_number
                  ? `Ждём ${s.next_release_episode_number} серию`
                  : s.published_release_episode
                    ? `Вышла ${fmtOrdinal(s.published_release_episode.ordinal)} серия`
                    : undefined
              }
            />
          ))
        )}
      </div>
    </div>
  )
}
