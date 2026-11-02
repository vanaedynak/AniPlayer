import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BookOpen, Check, Loader2, ArrowDownUp, BookText, Languages } from 'lucide-react'
import { Cover } from '../manga/ui'
import { useManga, READ_LABELS, type ReadStatus } from '../manga/store'
import { Empty, Skeleton } from '../components/ui'
import { useAsync } from '../lib/useAsync'
import { cn } from '../lib/format'
import { sourceById } from './registry'
import { loadNovel } from './cache'
import { chapterPath, entryId, rememberNovel } from './shelf'
import { useSaved } from '../manga/saved'
import { ChapterSave, SaveMenu, pickToSave, useSavedFor } from '../manga/SaveButtons'

/** a ranobe from an online source: cover, description, status and every chapter with what is already read */
export default function NovelPage() {
  const { src = '', id = '' } = useParams()
  const novelId = decodeURIComponent(id)
  const source = sourceById(src)
  const { data: n, error } = useAsync(() => loadNovel(src, novelId), [src, novelId])
  const eid = entryId(src, novelId)
  const entry = useManga((s) => s.entries[eid])
  const toggleRead = useManga((s) => s.toggleRead)
  const [reverse, setReverse] = useState(false)
  const [more, setMore] = useState(false)
  const saved = useSavedFor(eid)

  const read = useMemo(() => new Set(entry?.read ?? []), [entry?.read])
  const chapters = n ? (reverse ? [...n.chapters].reverse() : n.chapters) : []
  const resume = n && entry?.lastChapterId ? n.chapters.find((c) => c.id === entry.lastChapterId) : null
  const firstUnread = n?.chapters.find((c) => !read.has(c.id))

  if (!source) return <Empty icon={<BookText />} title="Неизвестный источник" />
  if (error) return <Empty icon={<BookText />} title="Не удалось открыть ранобэ" text={error} />
  if (!n)
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-[360px] w-full rounded-[32px]" />
        <Skeleton className="h-12 w-72" />
      </div>
    )

  const setStatus = (status: ReadStatus | null) => {
    rememberNovel(src, n, source.lang)
    useManga.getState().touch({ id: eid, title: n.title, cover: n.cover, lang: source.lang }, { kind: 'Ранобэ', status })
  }
  const start = resume ?? firstUnread ?? n.chapters[0]
  const saveSome = (ids: string[]) => {
    rememberNovel(src, n, source.lang)
    useSaved.getState().saveNovel(src, n, ids)
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="animate-fade-up relative rounded-[32px] ring-1 ring-white/5">
        <div className="absolute inset-0 overflow-hidden rounded-[32px]">
          {n.cover && <img src={n.cover} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />}
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/30" />
        </div>
        <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:p-10">
          <Cover src={n.cover} className="aspect-[2/3] w-40 shrink-0 self-center rounded-3xl shadow-2xl ring-1 ring-white/10 sm:w-52 sm:self-start" />
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              <span className="glass rounded-full px-3 py-1">{source.name}</span>
              {source.lang === 'en' && (
                <span className="flex items-center gap-1 rounded-full bg-accent/30 px-3 py-1 text-accent-2">
                  <Languages size={13} /> English · переводится Gemini
                </span>
              )}
              {n.status && <span className="glass rounded-full px-3 py-1">{n.status}</span>}
              {n.genres.slice(0, 6).map((g) => (
                <span key={g} className="glass rounded-full px-3 py-1">
                  {g}
                </span>
              ))}
            </div>
            <div>
              <h1 className="text-3xl leading-tight font-extrabold tracking-tight sm:text-5xl">{n.title}</h1>
              {n.original && <div className="mt-1 font-semibold text-muted">{n.original}</div>}
            </div>
            <div className="text-sm font-semibold text-white/80">
              {n.chapters.length} гл.{read.size ? ` · прочитано ${read.size}` : ''}
            </div>
            {n.summary && (
              <>
                <p className={cn('max-w-3xl text-[15px] leading-relaxed whitespace-pre-line text-white/80', !more && 'line-clamp-4')}>{n.summary}</p>
                {n.summary.length > 300 && (
                  <button onClick={() => setMore(!more)} className="self-start text-sm font-bold text-accent-2">
                    {more ? 'Свернуть' : 'Читать полностью'}
                  </button>
                )}
              </>
            )}
            <div className="flex flex-wrap gap-3">
              {start && (
                <Link
                  to={chapterPath(src, novelId, start.id)}
                  onClick={() => rememberNovel(src, n, source.lang)}
                  className="flex h-12 items-center gap-2 rounded-full bg-white px-7 font-extrabold text-black transition hover:scale-[1.03]"
                >
                  <BookOpen size={18} /> {resume ? `Продолжить · ${resume.title}` : 'Читать'}
                </Link>
              )}
              <select
                value={entry?.status ?? ''}
                onChange={(e) => setStatus((e.target.value || null) as ReadStatus | null)}
                className="h-12 rounded-full bg-white/10 px-5 font-bold ring-1 ring-white/10 outline-none"
              >
                <option value="">В список…</option>
                {(Object.keys(READ_LABELS) as ReadStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {READ_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-extrabold">
            Главы <span className="text-base font-semibold text-muted">· {n.chapters.length}</span>
          </h2>
          <div className="flex items-center gap-2">
          {n.chapters.length > 0 && (
            <SaveMenu
              saved={saved.done}
              total={n.chapters.length}
              onPick={(k) => saveSome(pickToSave(n.chapters, start ? n.chapters.indexOf(start) : 0, k, (c) => read.has(c.id)).map((c) => c.id))}
            />
          )}
          <button
            onClick={() => setReverse(!reverse)}
            title="Порядок"
            className={cn('flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-white/10', reverse ? 'bg-white text-black' : 'bg-card-2')}
          >
            <ArrowDownUp size={16} />
          </button>
          </div>
        </div>
        {!n.chapters.length ? (
          <Empty icon={<Loader2 />} title="Глав пока нет" />
        ) : (
          <div className="flex flex-col divide-y divide-white/5 overflow-hidden rounded-3xl bg-card ring-1 ring-white/5">
            {chapters.map((c, i) => {
              const prev = chapters[i - 1]
              const isRead = read.has(c.id)
              return (
                <div key={c.id}>
                  {c.volume && c.volume !== prev?.volume && <div className="bg-card-2 px-5 py-2 text-xs font-extrabold tracking-wide text-muted uppercase">{c.volume}</div>}
                  <div className={cn('flex items-center gap-3 px-5 py-3 hover:bg-white/5', c.id === entry?.lastChapterId && 'bg-accent/10')}>
                    <Link to={chapterPath(src, novelId, c.id)} onClick={() => rememberNovel(src, n, source.lang)} className={cn('min-w-0 flex-1 truncate font-semibold', isRead && 'text-white/45')}>
                      {c.title}
                    </Link>
                    {c.id === entry?.lastChapterId && <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold">Здесь</span>}
                    <ChapterSave it={saved.byChapter[c.id]} onSave={() => saveSome([c.id])} />
                    <button
                      onClick={() => {
                        rememberNovel(src, n, source.lang)
                        toggleRead(eid, [c.id], !isRead)
                      }}
                      title={isRead ? 'Отметить непрочитанной' : 'Отметить прочитанной'}
                      className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', isRead ? 'text-lime-400' : 'text-white/25 hover:bg-white/10 hover:text-white')}
                    >
                      <Check size={16} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
