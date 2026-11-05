import { Link } from 'react-router-dom'
import { Check, FolderOpen, HardDriveDownload, Magnet, Pause, Play, X } from 'lucide-react'
import { fmtBytes } from '../lib/downloads'
import { useTorrentSaves, type TorrentSave } from '../lib/torrent'
import { Panel } from './ui'
import { cn } from '../lib/format'

const pctOf = (s: TorrentSave) => Math.floor(s.progress * 100)

function SaveRow({ s, refresh }: { s: TorrentSave; refresh: () => void }) {
  const t = window.aniplayer!.torrent!
  const btn = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white'
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.04]">
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{s.name}</div>
        <div className={cn('text-sm font-semibold', s.done ? 'text-emerald-300' : 'text-muted')}>
          {s.done
            ? `Сохранено · ${fmtBytes(s.size)}`
            : s.paused
              ? `На паузе · ${pctOf(s)}% из ${fmtBytes(s.size)}`
              : `${pctOf(s)}% из ${fmtBytes(s.size)} · ${fmtBytes(s.down)}/с · ${s.peers} пир.`}
        </div>
        {!s.done && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
            <div className={cn('h-full rounded-full', s.paused ? 'bg-white/30' : 'bg-accent')} style={{ width: `${s.progress * 100}%` }} />
          </div>
        )}
      </div>
      <Link to={`/torrent?saved=${s.hash}`} className="flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-bold text-black">
        <Play size={14} fill="currentColor" /> Смотреть
      </Link>
      {!s.done && (
        <button className={btn} title={s.paused ? 'Продолжить' : 'Пауза'} onClick={() => void t.pauseSave!(s.hash, !s.paused).then(refresh)}>
          {s.paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
      )}
      <button className={btn} title="Открыть папку" onClick={() => void t.showSave!(s.hash)}>
        <FolderOpen size={16} />
      </button>
      <button
        className={cn(btn, 'hover:text-rose-300')}
        title="Убрать из списка (файлы останутся в папке)"
        onClick={() => {
          if (confirm(`Убрать «${s.name}» из загрузок? Скачанные файлы останутся в папке.`)) void t.removeSave!(s.hash).then(refresh)
        }}
      >
        <X size={16} />
      </button>
    </div>
  )
}

/** "Торренты на диске" on the downloads page */
export function TorrentSavesPanel() {
  const { list, refresh } = useTorrentSaves()
  if (!list.length) return null
  return (
    <Panel className="!p-4 sm:!p-5">
      <div className="mb-2 flex items-center gap-2 text-lg font-extrabold">
        <Magnet size={18} className="text-accent-2" /> Торренты на диске
      </div>
      <div className="flex flex-col">
        {list.map((s) => (
          <SaveRow key={s.hash} s={s} refresh={refresh} />
        ))}
      </div>
    </Panel>
  )
}

/** "Сохранить на диск" in the torrent player, then how far the save has got */
export function SaveTorrentButton({ hash }: { hash: string }) {
  const { list, refresh } = useTorrentSaves()
  const t = window.aniplayer?.torrent
  if (!t?.save) return null
  const s = list.find((x) => x.hash === hash)
  const base = 'flex h-12 items-center gap-2 rounded-full px-5 font-bold ring-1 transition'
  if (!s)
    return (
      <button
        className={cn(base, 'bg-card-2 ring-white/5 hover:bg-white/10')}
        title="Скачать все файлы торрента в папку на ПК"
        onClick={() =>
          void t.save!(hash)
            .then(refresh)
            .catch((e) => alert(`Не получилось: ${e?.message ?? e}`))
        }
      >
        <HardDriveDownload size={17} /> Сохранить на диск
      </button>
    )
  if (s.done)
    return (
      <button className={cn(base, 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30')} onClick={() => void t.showSave!(hash)} title="Открыть папку">
        <Check size={17} /> Сохранено · открыть папку
      </button>
    )
  return (
    <Link to="/downloads" className={cn(base, 'bg-card-2 ring-white/5 hover:bg-white/10')} title="Ход загрузки — в разделе «Загрузки»">
      <HardDriveDownload size={17} /> {s.paused ? 'На паузе' : 'Сохраняется'} · {pctOf(s)}%
    </Link>
  )
}
