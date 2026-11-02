import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ChevronDown, Download, Loader2, Trash2 } from 'lucide-react'
import { pct, useSaved, type SavedChapter } from './saved'
import { cn } from '../lib/format'

/** the download mark next to a chapter: save it, see it saving, remove it */
export function ChapterSave({ it, onSave }: { it?: SavedChapter; onSave: () => void }) {
  const { remove, retry } = useSaved.getState()
  const base = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition'
  if (!it)
    return (
      <button onClick={onSave} title="Скачать главу — читать без интернета" className={cn(base, 'text-white/25 hover:bg-white/10 hover:text-white')}>
        <Download size={16} />
      </button>
    )
  if (it.status === 'done')
    return (
      <button onClick={() => void remove(it.key)} title="Скачано. Нажмите, чтобы удалить с устройства" className={cn(base, 'group text-sky-300 hover:bg-rose-500/15 hover:text-rose-300')}>
        <Download size={16} className="group-hover:hidden" />
        <Trash2 size={15} className="hidden group-hover:block" />
      </button>
    )
  if (it.status === 'error')
    return (
      <button onClick={() => retry(it.key)} title={`${it.error ?? 'Ошибка'}. Нажмите, чтобы повторить`} className={cn(base, 'text-rose-400 hover:bg-white/10')}>
        <AlertCircle size={16} />
      </button>
    )
  return (
    <button onClick={() => void remove(it.key)} title="Скачивается. Нажмите, чтобы отменить" className={cn(base, 'relative text-white/70 hover:bg-white/10')}>
      {it.status === 'queued' ? <Loader2 size={15} className="animate-spin opacity-50" /> : <span className="text-[10px] font-extrabold tabular-nums">{pct(it)}%</span>}
    </button>
  )
}

/** "Скачать ▾": the next few chapters from where reading stopped, or every unread one */
export function SaveMenu({ onPick, saved, total }: { onPick: (n: number | 'unread') => void; saved: number; total: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  const pick = (n: number | 'unread') => {
    onPick(n)
    setOpen(false)
  }
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex h-10 items-center gap-2 rounded-full bg-card-2 px-4 text-sm font-bold ring-1 ring-white/5 hover:bg-white/10" title="Скачать главы, чтобы читать без интернета">
        <Download size={15} /> Скачать{saved ? ` · ${saved}` : ''} <ChevronDown size={14} />
      </button>
      {open && (
        <div className="animate-pop absolute right-0 z-30 mt-2 flex w-60 flex-col rounded-2xl bg-card-2 p-1.5 shadow-2xl ring-1 ring-white/10">
          {[5, 10, 25].map((n) => (
            <button key={n} onClick={() => pick(n)} className="rounded-xl px-3 py-2.5 text-left text-sm font-bold hover:bg-white/10">
              Следующие {n} глав
            </button>
          ))}
          <button onClick={() => pick('unread')} className="rounded-xl px-3 py-2.5 text-left text-sm font-bold hover:bg-white/10">
            Все непрочитанные
          </button>
          <div className="px-3 pt-1 pb-2 text-xs text-white/45">
            {saved ? `Скачано ${saved} из ${total}. ` : ''}Скачанные главы открываются без интернета и лежат в «Загрузках».
          </div>
        </div>
      )}
    </div>
  )
}

/** the chapters to save for a menu pick: from where reading stands, onwards */
export function pickToSave<T>(list: T[], from: number, n: number | 'unread', isRead: (c: T) => boolean) {
  const rest = list.slice(Math.max(0, from))
  return n === 'unread' ? rest.filter((c) => !isRead(c)) : rest.slice(0, n)
}

export function useSavedFor(entry: string) {
  const items = useSaved((s) => s.items)
  const mine: Record<string, SavedChapter> = {}
  let done = 0
  for (const it of Object.values(items))
    if (it.entry === entry) {
      mine[it.chapterId] = it
      if (it.status === 'done') done++
    }
  return { byChapter: mine, done }
}
