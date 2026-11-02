import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Trash2 } from 'lucide-react'
import { useSaved } from './saved'
import { coverUrl } from './md'
import { Cover } from './ui'
import { Panel } from '../components/ui'
import { fmtBytes } from '../lib/downloads'
import { cn } from '../lib/format'

/** downloaded manga and ranobe chapters on the "Загрузки" page, one row per title */
export function SavedShelf() {
  const items = useSaved((s) => s.items)
  const titles = useSaved((s) => s.titles)
  const rows = useMemo(() => {
    const by = new Map<string, (typeof items)[string][]>()
    for (const it of Object.values(items)) by.set(it.entry, [...(by.get(it.entry) ?? []), it])
    return [...by.entries()]
      .map(([entry, list]) => ({ entry, list: list.sort((a, b) => a.order - b.order), t: titles[entry] }))
      .filter((r) => r.t)
      .sort((a, b) => Math.max(...b.list.map((i) => i.addedAt)) - Math.max(...a.list.map((i) => i.addedAt)))
  }, [items, titles])
  if (!rows.length) return null
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-2xl font-extrabold tracking-tight">Манга и ранобэ</h2>
      {rows.map(({ entry, list, t }) => {
        const done = list.filter((i) => i.status === 'done')
        const saving = list.find((i) => i.status === 'saving')
        const href = t.kind === 'manga' ? `/manga/${entry}` : `/ranobe/n/${t.src}/${encodeURIComponent(t.novelId ?? '')}`
        const first = done[0]
        const read = first && (t.kind === 'manga' ? `/manga/read/${entry}/${first.chapterId}` : `${href}/${encodeURIComponent(first.chapterId)}`)
        return (
          <Panel key={entry} className="flex items-center gap-4 !p-4">
            <Cover src={t.kind === 'manga' ? coverUrl(t) : t.cover} className="h-20 w-14 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <Link to={href} className="line-clamp-2 text-lg font-extrabold hover:underline">
                {t.title}
              </Link>
              <div className="text-sm font-semibold text-muted">
                {t.kind === 'manga' ? 'Манга' : 'Ранобэ'} · {done.length} из {list.length} гл. · {fmtBytes(list.reduce((a, i) => a + i.bytes, 0))}
                {saving && <span className="text-accent-2"> · качаю {saving.label}</span>}
              </div>
              {done.length > 0 && (
                <div className="mt-1 truncate text-xs text-dim">
                  {done[0].label}
                  {done.length > 1 ? ` — ${done[done.length - 1].label}` : ''}
                </div>
              )}
            </div>
            {read && (
              <Link to={read} className="flex h-11 items-center gap-2 rounded-full bg-white px-5 font-bold text-black">
                <BookOpen size={16} /> Читать
              </Link>
            )}
            <button
              onClick={() => void useSaved.getState().removeTitle(entry)}
              title="Удалить скачанные главы"
              className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/50 ring-1 ring-white/10 hover:bg-rose-500/15 hover:text-rose-300')}
            >
              <Trash2 size={17} />
            </button>
          </Panel>
        )
      })}
    </div>
  )
}
