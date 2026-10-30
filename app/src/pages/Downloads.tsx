import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { HardDriveDownload, Play, WifiOff } from 'lucide-react'
import { useDownloads, fmtBytes } from '../lib/downloads'
import { posterUrl } from '../lib/api'
import { freeSpace } from '../lib/offline'
import { DownloadRow } from '../components/Downloads'
import { Empty, Panel } from '../components/ui'

export default function Downloads() {
  const items = useDownloads((s) => s.items)
  const releases = useDownloads((s) => s.releases)
  const [free, setFree] = useState<number | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    void freeSpace().then(setFree)
    const on = () => setOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', on)
    }
  }, [])

  const groups = useMemo(() => {
    const m = new Map<string, typeof list>()
    const list = Object.values(items).sort((a, b) => a.ordinal - b.ordinal)
    for (const it of list) m.set(it.alias, [...(m.get(it.alias) ?? []), it])
    return [...m.entries()].sort((a, b) => Math.max(...b[1].map((i) => i.addedAt)) - Math.max(...a[1].map((i) => i.addedAt)))
  }, [items])
  const total = Object.values(items).reduce((a, i) => a + i.bytes, 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Загрузки</h1>
          <div className="mt-1 text-sm font-semibold text-muted">
            {fmtBytes(total)} на устройстве{free != null ? ` · свободно ~${fmtBytes(free)}` : ''}
          </div>
        </div>
        {!online && (
          <span className="flex items-center gap-2 rounded-full bg-yellow-400/10 px-4 py-2 text-sm font-bold text-yellow-300">
            <WifiOff size={16} /> Нет интернета — доступны скачанные серии
          </span>
        )}
      </div>

      {groups.length ? (
        groups.map(([alias, list]) => {
          const r = releases[alias]
          const firstDone = list.find((i) => i.status === 'done')
          return (
            <Panel key={alias} className="!p-4 sm:!p-5">
              <div className="mb-3 flex items-center gap-4">
                <div className="h-20 w-14 shrink-0 overflow-hidden rounded-xl bg-white/5">
                  {r && <img src={posterUrl(r, 'thumbnail')} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />}
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/title/${alias}`} className="line-clamp-2 text-lg font-extrabold hover:underline">
                    {r?.name.main ?? alias}
                  </Link>
                  <div className="text-sm font-semibold text-muted">
                    {list.filter((i) => i.status === 'done').length} из {list.length} сер. · {fmtBytes(list.reduce((a, i) => a + i.bytes, 0))}
                  </div>
                </div>
                {firstDone && (
                  <Link to={`/watch/${alias}/${firstDone.ordinal}`} className="flex h-11 items-center gap-2 rounded-full bg-white px-5 font-bold text-black">
                    <Play size={16} fill="currentColor" /> Смотреть
                  </Link>
                )}
              </div>
              <div className="flex flex-col">
                {list.map((it) => (
                  <DownloadRow key={it.key} it={it} />
                ))}
              </div>
            </Panel>
          )
        })
      ) : (
        <Empty
          icon={<HardDriveDownload />}
          title="Пока ничего не скачано"
          text="Откройте аниме с AniLibria и нажмите «Скачать сезон» или «Скачать» у серии — смотреть можно будет без интернета."
        />
      )}
    </div>
  )
}
