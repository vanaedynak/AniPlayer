import { useState } from 'react'
import { Download, Check, Loader2, Pause, Play, X, AlertCircle, Trash2 } from 'lucide-react'
import type { Episode, Release } from '../lib/api'
import { useDownloads, dlKey, fmtBytes, type DlItem, type DlQuality } from '../lib/downloads'
import { cn } from '../lib/format'

const QUALITIES: DlQuality[] = ['480', '720', '1080']
const pct = (i: DlItem) => (i.total ? Math.round((i.done / i.total) * 100) : 0)

/** "Скачать серию" on the watch page */
export function DownloadEpisodeButton({ r, e }: { r: Release; e: Episode }) {
  const it = useDownloads((s) => s.items[dlKey(r.id, e.ordinal)])
  const { add, remove, pause, resume } = useDownloads.getState()
  const base = 'flex h-12 items-center gap-2 rounded-full px-5 font-bold ring-1 transition'
  if (!it)
    return (
      <button className={cn(base, 'bg-white/10 ring-white/10 hover:bg-white/15')} onClick={() => add(r, [e])}>
        <Download size={18} /> Скачать
      </button>
    )
  if (it.status === 'done')
    return (
      <button className={cn(base, 'group bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 hover:bg-rose-500/15 hover:text-rose-300')} onClick={() => remove(it.key)} title="Удалить с устройства">
        <Check size={18} className="group-hover:hidden" />
        <Trash2 size={18} className="hidden group-hover:block" /> Скачано · {fmtBytes(it.bytes)}
      </button>
    )
  return (
    <button
      className={cn(base, 'bg-white/10 ring-white/10 hover:bg-white/15')}
      onClick={() => (it.status === 'downloading' || it.status === 'queued' ? pause(it.key) : resume(it.key))}
    >
      {it.status === 'downloading' ? <Loader2 size={18} className="animate-spin" /> : it.status === 'error' ? <AlertCircle size={18} className="text-rose-400" /> : <Pause size={18} />}
      {it.status === 'downloading' ? `${pct(it)}%` : it.status === 'queued' ? 'В очереди' : it.status === 'error' ? 'Повторить' : 'Продолжить'}
    </button>
  )
}

/** "Скачать сезон" panel on the title page */
export function DownloadSeason({ r, episodes }: { r: Release; episodes: Episode[] }) {
  const items = useDownloads((s) => s.items)
  const quality = useDownloads((s) => s.quality)
  const { add, setQuality, removeRelease } = useDownloads.getState()
  const [open, setOpen] = useState(false)
  const mine = episodes.map((e) => items[dlKey(r.id, e.ordinal)]).filter(Boolean)
  const done = mine.filter((i) => i.status === 'done')
  const running = mine.find((i) => i.status === 'downloading')
  const bytes = mine.reduce((a, i) => a + i.bytes, 0)
  const missing = episodes.filter((e) => !items[dlKey(r.id, e.ordinal)] || items[dlKey(r.id, e.ordinal)].status === 'error')
  if (!episodes.length) return null
  // AniLibria episodes run ~350 MB at 720p; a rough guide for the size picker
  const per = { '480': 180, '720': 350, '1080': 700 }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-12 items-center gap-2 rounded-full px-5 font-bold ring-1 transition',
          done.length === episodes.length ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' : 'bg-white/10 ring-white/10 hover:bg-white/15',
        )}
      >
        {running ? <Loader2 size={18} className="animate-spin" /> : done.length === episodes.length ? <Check size={18} /> : <Download size={18} />}
        {done.length === episodes.length
          ? `Скачано · ${fmtBytes(bytes)}`
          : mine.length
            ? `Скачано ${done.length} из ${episodes.length}${running ? ` · ${pct(running)}%` : ''}`
            : 'Скачать сезон'}
      </button>
      {open && (
        <div className="animate-pop glass absolute top-full right-0 z-30 mt-2 w-80 rounded-2xl p-4 shadow-2xl ring-1 ring-white/10 sm:left-0">
          <div className="mb-1 font-extrabold">Скачать для просмотра без интернета</div>
          <div className="mb-3 text-xs text-muted">Только видео AniLibria. Скачанные серии видны в разделе «Загрузки».</div>
          <div className="mb-3 flex gap-2">
            {QUALITIES.map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={cn('flex-1 rounded-xl py-2 text-sm font-bold ring-1', q === quality ? 'bg-white text-black ring-white' : 'bg-white/5 ring-white/10 hover:bg-white/10')}
              >
                {q}p
                <div className={cn('text-[10px] font-semibold', q === quality ? 'text-black/60' : 'text-muted')}>~{per[q]} МБ/сер.</div>
              </button>
            ))}
          </div>
          {missing.length > 0 && (
            <button
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white font-bold text-black"
              onClick={() => {
                add(r, missing)
                setOpen(false)
              }}
            >
              <Download size={17} /> {missing.length === episodes.length ? 'Все' : 'Оставшиеся'} {missing.length} сер. · ~{fmtBytes(missing.length * per[quality] * 1e6)}
            </button>
          )}
          {mine.length > 0 && (
            <button className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-rose-300 hover:bg-rose-500/10" onClick={() => removeRelease(r.id)}>
              <Trash2 size={16} /> Удалить скачанное
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** one row on the downloads page */
export function DownloadRow({ it }: { it: DlItem }) {
  const { remove, pause, resume } = useDownloads.getState()
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/[0.04]">
      <div className="w-16 shrink-0 text-sm font-bold">{it.ordinal} сер.</div>
      <div className="min-w-0 flex-1">
        {it.status === 'done' ? (
          <div className="text-sm font-semibold text-emerald-300">
            Готово · {it.quality}p · {fmtBytes(it.bytes)}
          </div>
        ) : (
          <>
            <div className="mb-1 flex justify-between text-xs font-semibold text-muted">
              <span>{it.status === 'downloading' ? 'Скачивается' : it.status === 'queued' ? 'В очереди' : it.status === 'paused' ? 'Пауза' : `Ошибка: ${it.error}`}</span>
              <span>{it.total ? `${pct(it)}% · ${fmtBytes(it.bytes)}` : ''}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-pink transition-all" style={{ width: `${pct(it)}%` }} />
            </div>
          </>
        )}
      </div>
      {it.status !== 'done' && (
        <button
          className="rounded-full p-2 hover:bg-white/10"
          onClick={() => (it.status === 'downloading' || it.status === 'queued' ? pause(it.key) : resume(it.key))}
          title={it.status === 'downloading' || it.status === 'queued' ? 'Пауза' : 'Продолжить'}
        >
          {it.status === 'downloading' || it.status === 'queued' ? <Pause size={16} /> : <Play size={16} />}
        </button>
      )}
      <button className="rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-rose-300" onClick={() => remove(it.key)} title="Удалить">
        <X size={16} />
      </button>
    </div>
  )
}
