import { useRef, useState } from 'react'
import { FileUp, Loader2, Magnet } from 'lucide-react'
import { openUserTorrent, type TorrentInfo } from '../lib/torrent'
import { cn } from '../lib/format'

/**
 * «Свой торрент»: a pasted magnet link or a picked .torrent file. A magnet has to fetch the torrent's
 * description from peers first, which can take up to a minute on a quiet release.
 */
export function TorrentOpenForm({ onOpen, className }: { onOpen: (info: TorrentInfo) => void; className?: string }) {
  const [magnet, setMagnet] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const open = async (input: string | File) => {
    setBusy(true)
    setError('')
    try {
      const info = await openUserTorrent(input)
      if (!info.files.length) throw new Error('в раздаче нет видео')
      onOpen(info)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-3', className)} onPointerUp={(e) => e.stopPropagation()}>
      <textarea
        value={magnet}
        onChange={(e) => setMagnet(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && magnet.trim()) {
            e.preventDefault()
            void open(magnet)
          }
        }}
        placeholder="magnet:?xt=urn:btih:…"
        rows={3}
        spellCheck={false}
        className="w-full resize-none rounded-2xl bg-black/40 px-4 py-3 font-mono text-xs text-white ring-1 ring-white/10 outline-none placeholder:text-white/30 focus:ring-accent/60"
      />
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy || !magnet.trim()}
          onClick={() => void open(magnet)}
          className="flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-extrabold text-black transition hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Magnet size={16} />}
          Открыть ссылку
        </button>
        <button
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="flex h-11 items-center gap-2 rounded-full bg-white/10 px-5 text-sm font-bold ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-40"
        >
          <FileUp size={16} /> Файл .torrent
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".torrent,application/x-bittorrent"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void open(f)
          }}
        />
      </div>
      {busy && <p className="text-xs text-white/50">Ищем раздачу у пиров — по magnet-ссылке это бывает до минуты…</p>}
      {error && <p className="text-sm font-semibold text-pink">{error}</p>}
    </div>
  )
}
