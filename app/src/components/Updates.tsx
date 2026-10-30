import { useEffect, useState } from 'react'
import { Download, RefreshCw, Loader2, Check, Sparkles } from 'lucide-react'
import { installUpdate, type UpdateState } from '../lib/platform'
import { Panel, PanelTitle } from './ui'
import { cn } from '../lib/format'

const bridge = () => window.aniplayer?.updates

/** live update state from Electron; null outside the desktop app */
export function useUpdates() {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    const u = bridge()
    if (!u) return
    u.get().then(setState)
    return u.onChange(setState)
  }, [])
  return state
}

/** header pill that appears once a new version is downloaded */
export function UpdatePill() {
  const s = useUpdates()
  if (s?.status !== 'ready') return null
  return (
    <button
      onClick={installUpdate}
      title={`Установить версию ${s.version}`}
      className="no-drag animate-pop mr-1 flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-accent to-pink px-4 text-sm font-extrabold shadow-lg shadow-accent/30 transition hover:scale-[1.04]"
    >
      <Sparkles size={16} /> Обновить
    </button>
  )
}

export function UpdateSettings() {
  const s = useUpdates()
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.aniplayer?.version?.().then(setVersion)
  }, [])
  if (!s) return null
  const btn = 'flex h-12 items-center gap-2 rounded-2xl px-5 font-bold transition disabled:opacity-50'
  return (
    <Panel>
      <PanelTitle icon={<Download className="text-sky-400" />} title="Обновления" sub={`Установлена версия ${version || '…'} · новые версии скачиваются сами`} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-semibold">
          {s.status === 'checking' && <span className="text-muted">Проверяем…</span>}
          {s.status === 'latest' && (
            <span className="flex items-center gap-2 text-emerald-400">
              <Check size={18} /> У вас последняя версия
            </span>
          )}
          {s.status === 'downloading' && (
            <span className="flex items-center gap-2 text-white/80">
              <Loader2 size={18} className="animate-spin" /> Скачиваем {s.version ?? 'обновление'} · {Math.round(s.percent ?? 0)}%
            </span>
          )}
          {s.status === 'ready' && <span className="text-white">Версия {s.version} готова к установке</span>}
          {s.status === 'error' && <span className="text-rose-400">Не удалось проверить: {s.message}</span>}
          {s.status === 'idle' && <span className="text-muted">Проверка запустится автоматически</span>}
        </div>
        {s.status === 'ready' ? (
          <button className={cn(btn, 'bg-white text-black')} onClick={installUpdate}>
            <Sparkles size={18} /> Перезапустить и обновить
          </button>
        ) : (
          <button className={cn(btn, 'bg-white/10 hover:bg-white/15')} disabled={s.status === 'checking' || s.status === 'downloading'} onClick={() => bridge()?.check()}>
            <RefreshCw size={18} /> Проверить обновления
          </button>
        )}
      </div>
    </Panel>
  )
}
