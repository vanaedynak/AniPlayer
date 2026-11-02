import { useEffect, useMemo, useState } from 'react'
import { Magnet, Film, RotateCcw } from 'lucide-react'
import Player from '../components/Player'
import { TorrentOpenForm } from '../components/TorrentOpen'
import { Empty, Panel } from '../components/ui'
import { EXTRA, episodeOf, torrentSupported, userSource, type TorrentInfo } from '../lib/torrent'
import type { Episode, Release } from '../lib/api'
import { cn } from '../lib/format'


/** the torrent's videos as a title's episodes: by episode number, extras at the end */
function asEpisodes(info: TorrentInfo): Episode[] {
  const files = [...info.files].sort(
    (a, b) =>
      Number(EXTRA.test(a.path)) - Number(EXTRA.test(b.path)) ||
      (episodeOf(a.name) ?? 1e9) - (episodeOf(b.name) ?? 1e9) ||
      a.path.localeCompare(b.path, undefined, { numeric: true }),
  )
  return files.map((f, i) => ({
    id: `tf:${f.index}`,
    name: f.name.replace(/\.[^.]+$/, ''),
    ordinal: EXTRA.test(f.path) ? i + 1 : (episodeOf(f.name) ?? i + 1),
    hls_480: null,
    hls_720: null,
    hls_1080: null,
    duration: null,
    sort_order: i,
    release_id: 0,
  }))
}

/**
 * «Торрент-плеер»: any magnet link or .torrent file, for anime AniLibria doesn't have. The same player,
 * dubs and subtitles from the mkv; nothing goes to history, the torrent has no title behind it.
 */
export default function TorrentPlayer() {
  const [info, setInfo] = useState<TorrentInfo | null>(null)
  const [cur, setCur] = useState('')
  const episodes = useMemo(() => (info ? asEpisodes(info) : []), [info])
  const source = useMemo(() => (info ? userSource(info) : undefined), [info])
  const release = useMemo(() => (info ? ({ id: 0, name: { main: info.name, english: null, alternative: null }, alias: '', episodes } as unknown as Release) : null), [info, episodes])
  useEffect(() => {
    document.title = info ? `${info.name} · Торрент` : 'Торрент-плеер'
    return () => {
      document.title = 'Anyflow'
    }
  }, [info])

  if (!torrentSupported()) return <Empty icon={<Magnet />} title="Торрент-плеер" text="Свои торренты открываются в приложении для ПК" />

  if (!info || !release || !source)
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight">
            <Magnet className="text-accent-2" /> Торрент-плеер
          </h1>
          <p className="mt-2 text-muted">
            Magnet-ссылка или .torrent файл — серия начнёт играть, пока скачивается. Озвучки и субтитры внутри MKV выбираются в настройках плеера.
          </p>
        </div>
        <Panel>
          <TorrentOpenForm
            onOpen={(i) => {
              setInfo(i)
              setCur(asEpisodes(i)[0]?.id ?? '')
            }}
          />
        </Panel>
      </div>
    )

  const idx = Math.max(0, episodes.findIndex((e) => e.id === cur))
  const episode = episodes[idx]
  return (
    <div className="flex flex-col gap-8">
      <div className="animate-fade-in -mx-4 sm:mx-0">
        <Player key={info.infoHash} release={release} episode={episode} next={episodes[idx + 1]} prev={episodes[idx - 1]} onSelect={(e) => setCur(e.id)} source={source} ephemeral />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold tracking-tight sm:text-3xl">{info.name}</h1>
          <div className="mt-1 truncate text-muted">{episode.name}</div>
        </div>
        <button onClick={() => setInfo(null)} className="flex h-12 items-center gap-2 rounded-full bg-card-2 px-5 font-bold ring-1 ring-white/5 hover:bg-white/10">
          <RotateCcw size={17} /> Другой торрент
        </button>
      </div>
      <Panel className="!p-4">
        <div className="mb-3 flex items-center gap-2 font-extrabold">
          <Film size={18} className="text-accent-2" /> Файлы · {episodes.length}
        </div>
        <div className="flex flex-col gap-1">
          {episodes.map((e) => (
            <button
              key={e.id}
              onClick={() => setCur(e.id)}
              className={cn('truncate rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition', e.id === episode.id ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5')}
            >
              {e.name}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  )
}
