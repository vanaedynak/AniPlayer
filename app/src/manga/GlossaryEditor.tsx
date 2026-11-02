import { useMemo, useState } from 'react'
import { BookA, Pencil, Trash2, Check } from 'lucide-react'
import { useGlossary } from './glossary'
import { cn } from '../lib/format'

/** the names and terms the translator has settled on for a title, each one fixable by hand */
export function GlossaryEditor({ title }: { title: string }) {
  const list = useGlossary((s) => s.lists[title])
  const { set, remove } = useGlossary.getState()
  const [edit, setEdit] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [q, setQ] = useState('')
  const rows = useMemo(
    () =>
      Object.entries(list ?? {})
        .filter(([o, t]) => !q || o.toLowerCase().includes(q.toLowerCase()) || t.ru.toLowerCase().includes(q.toLowerCase()))
        .sort(([a], [b]) => a.localeCompare(b)),
    [list, q],
  )
  const total = Object.keys(list ?? {}).length
  const save = (o: string) => {
    if (value.trim()) set(title, o, value.trim())
    setEdit(null)
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2 text-xs font-extrabold tracking-wide text-white/50 uppercase">
        <BookA size={15} /> Имена и термины {total > 0 && `· ${total}`}
      </div>
      <div className="leading-relaxed text-white/65">
        Переводчик запоминает, как он перевёл имена героев, места и названия, и дальше пишет их всегда одинаково. Если имя переведено неудачно — нажмите на него и впишите своё: в
        следующих главах будет ваш вариант.
      </div>
      {total === 0 ? (
        <div className="rounded-xl bg-white/5 px-4 py-3 text-white/50">Пока пусто — список появится после первой переведённой главы.</div>
      ) : (
        <>
          {total > 8 && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Найти имя"
              className="h-10 rounded-xl bg-white/10 px-4 ring-1 ring-white/10 outline-none focus:ring-accent"
            />
          )}
          <div className="flex flex-col gap-1">
            {rows.map(([o, t]) => (
              <div key={o} className="group flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-white/5">
                <div className="min-w-0 flex-1 truncate text-white/55" title={o}>
                  {o}
                </div>
                <span className="text-white/30">→</span>
                {edit === o ? (
                  <input
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') save(o)
                      if (e.key === 'Escape') setEdit(null)
                    }}
                    onBlur={() => save(o)}
                    className="h-8 min-w-0 flex-1 rounded-lg bg-white/10 px-2 font-bold ring-1 ring-accent outline-none"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setEdit(o)
                      setValue(t.ru)
                    }}
                    title="Исправить"
                    className={cn('flex min-w-0 flex-1 items-center gap-1.5 truncate text-left font-bold', t.mine && 'text-accent-2')}
                  >
                    <span className="truncate">{t.ru}</span>
                    {t.mine ? <Check size={13} className="shrink-0" /> : <Pencil size={12} className="shrink-0 opacity-0 group-hover:opacity-50" />}
                  </button>
                )}
                <button
                  onClick={() => remove(title, o)}
                  title="Убрать из списка"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/30 hover:bg-white/10 hover:text-rose-300"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
