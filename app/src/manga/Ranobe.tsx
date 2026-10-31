import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookText, Plus, Loader2, Trash2, AlertCircle } from 'lucide-react'
import { importBook, useBooks } from './books'
import { ReadTabs } from './ui'
import { Empty } from '../components/ui'
import { fmtBytes } from '../lib/downloads'
import { relTime } from '../lib/format'

export default function Ranobe() {
  const books = useBooks((s) => s.books)
  const remove = useBooks((s) => s.remove)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState('')
  const list = useMemo(() => Object.values(books).sort((a, b) => Math.max(b.readAt, b.addedAt) - Math.max(a.readAt, a.addedAt)), [books])

  const add = async (picked: FileList | null) => {
    // copy first: the input is cleared right after picking, which empties its live FileList
    const files = [...(picked ?? [])]
    if (!files.length) return
    setError('')
    for (const f of files) {
      setBusy((b) => b + 1)
      try {
        await importBook(f)
      } catch (e) {
        setError(`${f.name}: ${(e as Error).message}`)
      } finally {
        setBusy((b) => b - 1)
      }
    }
  }

  const button = (
    <button onClick={() => input.current?.click()} className="flex h-12 items-center gap-2 rounded-full bg-white px-6 font-bold text-black transition hover:scale-[1.03]">
      {busy ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} Добавить книгу
    </button>
  )

  return (
    <div
      className="flex flex-col gap-6"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void add(e.dataTransfer.files)
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Ранобэ</h1>
          <div className="mt-1 max-w-2xl text-sm font-semibold text-muted">
            Читалка для книг в EPUB, FB2 и TXT: выберите файл или перетащите его сюда. Книги хранятся на этом устройстве и открываются без интернета.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ReadTabs />
          {list.length > 0 && button}
        </div>
      </div>
      <input ref={input} type="file" multiple accept=".epub,.fb2,.zip,.txt,application/epub+zip" className="hidden" onChange={(e) => (void add(e.target.files), (e.target.value = ''))} />
      {error && (
        <div className="flex items-center gap-2 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-300">
          <AlertCircle size={17} /> {error}
        </div>
      )}

      {list.length ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {list.map((b) => {
            const pct = b.chapters ? Math.round(((b.chapter + b.frac) / b.chapters) * 100) : 0
            return (
              <div key={b.id} className="group relative">
                <Link to={`/ranobe/${b.id}`} className="block">
                  <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-card ring-1 ring-white/5 transition duration-300 group-hover:-translate-y-1 group-hover:ring-white/15">
                    {b.cover ? (
                      <img src={b.cover} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full flex-col justify-between bg-gradient-to-br from-accent/40 via-card-2 to-pink/25 p-4">
                        <BookText size={28} className="text-white/60" />
                        <div className="line-clamp-5 text-lg leading-tight font-extrabold">{b.title}</div>
                      </div>
                    )}
                    {b.readAt > 0 && (
                      <div className="absolute inset-x-2 bottom-2">
                        <div className="h-1 overflow-hidden rounded-full bg-black/40">
                          <div className="h-full bg-accent-2" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-2.5 line-clamp-2 text-[15px] leading-snug font-bold">{b.title}</div>
                  <div className="mt-0.5 truncate text-xs font-medium text-muted">
                    {[b.author, b.readAt ? `${pct}% · ${relTime(b.readAt)}` : `${b.format.toUpperCase()} · ${fmtBytes(b.size)}`].filter(Boolean).join(' · ')}
                  </div>
                </Link>
                <button
                  onClick={() => confirm(`Удалить «${b.title}» с устройства?`) && remove(b.id)}
                  className="glass absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full opacity-0 transition group-hover:opacity-100 hover:text-rose-300 max-lg:opacity-100"
                  title="Удалить"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <Empty
          icon={<BookText />}
          title="Добавьте первую книгу"
          text="Ранобэ обычно выкладывают файлами EPUB или FB2 — на сайтах переводчиков, в их Telegram-каналах и библиотеках. Скачайте файл и откройте его здесь: будут темы, шрифты и закладка на месте, где остановились."
          action={button}
        />
      )}
    </div>
  )
}
