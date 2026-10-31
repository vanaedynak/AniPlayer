import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BookOpen, Check, ChevronDown, ExternalLink, Heart, Loader2, Star, ArrowDownUp, Users, Play, Tv } from 'lucide-react'
import { manga, coverUrl, mangaName, chapterKey, chapterLabel, KIND, LANGS, STATUS, GENRES } from './md'
import { useManga, READ_LABELS, type ReadStatus } from './store'
import { useChapters, pickLang } from './useChapters'
import { Cover } from './ui'
import { useAsync } from '../lib/useAsync'
import { Empty, Skeleton } from '../components/ui'
import { cn, relTime } from '../lib/format'

// known languages first, in LANGS order
const rank = (l: string) => {
  const i = Object.keys(LANGS).indexOf(l)
  return i < 0 ? 99 : i
}

export default function MangaTitle() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { data: m, error } = useAsync(() => manga(id), [id])
  const entry = useManga((s) => s.entries[id])
  const preferred = useManga((s) => s.prefs.lang)
  const { touch, toggleRead } = useManga.getState()
  const lang = m ? pickLang(m.langs, entry?.lang, preferred) : null
  const { list, groups, loading } = useChapters(id, lang, m?.sk)
  const [desc, setDesc] = useState(false)
  const [newest, setNewest] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [filter, setFilter] = useState('')

  const read = useMemo(() => new Set(entry?.read ?? []), [entry?.read])
  const shown = useMemo(() => {
    const l = filter ? list.filter((c) => (c.num ?? '').startsWith(filter.trim())) : list
    return newest ? [...l].reverse() : l
  }, [list, newest, filter])

  if (error) return <Empty icon={<BookOpen />} title="Не удалось открыть мангу" text={error} />
  if (!m)
    return (
      <div className="flex gap-6">
        <Skeleton className="aspect-[2/3] w-52 shrink-0" />
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    )

  const save = (patch: Parameters<typeof touch>[1]) => touch(m, patch)
  const readable = list.filter((c) => !c.external)
  const cont = entry?.lastChapterId && list.find((c) => c.id === entry.lastChapterId)
  const firstUnread = readable.find((c) => !read.has(chapterKey(c)))
  const start = cont || firstUnread || readable[0]
  const open = (chapterId: string) => {
    if (!entry) save({})
    nav(`/manga/read/${id}/${chapterId}`)
  }
  const genres = m.tags.filter((t) => GENRES[t]).map((t) => GENRES[t])

  return (
    <div className="flex flex-col gap-8">
      <div className="relative -mx-4 -mt-4 overflow-hidden px-4 pt-6 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:rounded-[32px] lg:px-8 lg:pt-8">
        <div className="absolute inset-0 -z-10">
          {m.cover && <img src={coverUrl(m, 512)} alt="" className="h-full w-full scale-110 object-cover opacity-30 blur-3xl" />}
          <div className="absolute inset-0 bg-gradient-to-b from-bg/40 via-bg/70 to-bg" />
        </div>
        <div className="flex flex-col gap-6 sm:flex-row">
          <Cover src={coverUrl(m, 512)} className="mx-auto aspect-[2/3] w-48 shrink-0 rounded-3xl shadow-2xl ring-1 ring-white/10 sm:mx-0 sm:w-56" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-lg bg-white/10 px-2.5 py-1">{KIND(m.lang)}</span>
              {m.year && <span className="rounded-lg bg-white/10 px-2.5 py-1">{m.year}</span>}
              {STATUS[m.status] && <span className={cn('rounded-lg px-2.5 py-1', m.status === 'ongoing' ? 'bg-accent' : 'bg-white/10')}>{STATUS[m.status]}</span>}
              {m.score ? (
                <span className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1">
                  <Star size={12} className="fill-yellow-400 text-yellow-400" /> {m.score.toFixed(2)}
                </span>
              ) : null}
              {m.follows ? <span className="rounded-lg bg-white/10 px-2.5 py-1">{m.follows.toLocaleString('ru')} в закладках</span> : null}
              {m.rating === 'erotica' && <span className="rounded-lg bg-rose-500/80 px-2.5 py-1">18+</span>}
            </div>
            <h1 className="text-3xl leading-tight font-extrabold tracking-tight sm:text-4xl">{mangaName(m)}</h1>
            <div className="text-sm font-semibold text-muted">{[m.ruTitle ? m.title : '', m.altTitle].filter(Boolean).join(' · ')}</div>
            {m.authors.length > 0 && <div className="text-sm text-white/80">Автор: {m.authors.join(', ')}</div>}
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {genres.map((g) => (
                  <span key={g} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-bold text-white/80 ring-1 ring-white/5">
                    {g}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-3">
              {start ? (
                <button onClick={() => open(start.id)} className="flex h-12 items-center gap-2 rounded-full bg-white px-6 font-bold text-black transition hover:scale-[1.03]">
                  <Play size={18} fill="currentColor" />
                  {cont ? `Продолжить · ${chapterLabel(cont).replace(/^Том \S+ · /, '')}` : firstUnread && read.size ? `Читать · ${chapterLabel(firstUnread)}` : 'Читать с начала'}
                </button>
              ) : loading ? (
                <span className="flex h-12 items-center gap-2 rounded-full bg-white/10 px-6 font-bold">
                  <Loader2 size={18} className="animate-spin" /> Загружаем главы
                </span>
              ) : null}
              <div className="relative">
                <button
                  onClick={() => setStatusOpen(!statusOpen)}
                  className={cn('flex h-12 items-center gap-2 rounded-full px-5 font-bold ring-1 transition', entry?.status ? 'bg-accent/20 text-accent-2 ring-accent/40' : 'bg-white/10 ring-white/10 hover:bg-white/15')}
                >
                  {entry?.status ? <Check size={18} /> : <BookOpen size={18} />}
                  {entry?.status ? READ_LABELS[entry.status] : 'На полку'}
                  <ChevronDown size={16} />
                </button>
                {statusOpen && (
                  <div className="animate-pop glass absolute top-full left-0 z-30 mt-2 w-52 rounded-2xl p-1.5 shadow-2xl ring-1 ring-white/10">
                    {(Object.keys(READ_LABELS) as ReadStatus[]).map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          save({ status: entry?.status === s ? null : s })
                          setStatusOpen(false)
                        }}
                        className={cn('flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-bold hover:bg-white/10', entry?.status === s && 'text-accent-2')}
                      >
                        {READ_LABELS[s]}
                        {entry?.status === s && <Check size={16} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => save({ favorite: !entry?.favorite })}
                className={cn('flex h-12 w-12 items-center justify-center rounded-full ring-1 transition', entry?.favorite ? 'bg-pink/20 text-pink ring-pink/40' : 'bg-white/10 ring-white/10 hover:bg-white/15')}
                title="Избранное"
              >
                <Heart size={19} fill={entry?.favorite ? 'currentColor' : 'none'} />
              </button>
              <Link
                to={`/search?q=${encodeURIComponent(m.title)}`}
                className="flex h-12 items-center gap-2 rounded-full bg-white/10 px-5 font-bold ring-1 ring-white/10 hover:bg-white/15"
                title="Найти аниме по этой манге"
              >
                <Tv size={18} /> Аниме
              </Link>
            </div>

            {m.description && (
              <div className="mt-2 max-w-3xl">
                <p className={cn('text-[15px] leading-relaxed whitespace-pre-line text-white/80', !desc && 'line-clamp-4')}>{m.description.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_]{1,2}/g, '')}</p>
                {m.description.length > 280 && (
                  <button onClick={() => setDesc(!desc)} className="mt-1 text-sm font-bold text-accent-2">
                    {desc ? 'Свернуть' : 'Читать полностью'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-extrabold tracking-tight">
            Главы {list.length > 0 && <span className="text-muted">{list.length}</span>}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {m.langs.length > 1 && (
              <select
                value={lang ?? ''}
                onChange={(e) => save({ lang: e.target.value, group: undefined })}
                className="h-10 rounded-full bg-card-2 px-4 text-sm font-bold ring-1 ring-white/5 outline-none"
                title="Язык перевода"
              >
                {[...m.langs].sort((a, b) => rank(a) - rank(b)).map((l) => (
                  <option key={l} value={l}>
                    {LANGS[l] ?? l}
                  </option>
                ))}
              </select>
            )}
            {groups.length > 1 && (
              <select
                value={entry?.group ?? ''}
                onChange={(e) => save({ group: e.target.value || undefined })}
                className="h-10 max-w-52 rounded-full bg-card-2 px-4 text-sm font-bold ring-1 ring-white/5 outline-none"
                title="Команда перевода"
              >
                <option value="">Лучший перевод</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}
            {list.length > 30 && (
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="№ главы"
                inputMode="decimal"
                className="h-10 w-28 rounded-full bg-card-2 px-4 text-sm font-bold ring-1 ring-white/5 outline-none placeholder:text-dim"
              />
            )}
            <button onClick={() => setNewest(!newest)} className="flex h-10 items-center gap-2 rounded-full bg-card-2 px-4 text-sm font-bold ring-1 ring-white/5 hover:bg-white/10">
              <ArrowDownUp size={15} /> {newest ? 'Сначала новые' : 'По порядку'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !list.length ? (
          <Empty icon={<BookOpen />} title="Глав на этом языке пока нет" text="Попробуйте выбрать другой язык перевода." />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {shown.slice(0, 400).map((c) => {
              const done = read.has(chapterKey(c))
              const current = entry?.lastChapterId === c.id
              const body = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate font-bold', done && !current && 'text-white/45')}>
                      {c.lang !== lang && <span className="mr-1.5 rounded bg-sky-500/20 px-1.5 py-0.5 align-middle text-[10px] font-extrabold text-sky-300 uppercase">{c.lang}</span>}
                      {chapterLabel(c)}
                      {c.title && c.num != null && <span className="font-semibold text-muted"> · {c.title}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 truncate text-xs font-semibold text-dim">
                      {c.group && (
                        <>
                          <Users size={11} /> {c.group} ·
                        </>
                      )}{' '}
                      {relTime(c.at)}
                      {current && entry?.lastPages ? <span className="text-accent-2"> · стр. {(entry.lastPage ?? 0) + 1} из {entry.lastPages}</span> : null}
                    </div>
                  </div>
                  {c.external ? <ExternalLink size={16} className="shrink-0 text-muted" /> : null}
                </>
              )
              return (
                <div key={c.id} className={cn('group flex items-center gap-2 rounded-2xl bg-card/80 pr-2 ring-1 ring-white/[0.04] transition hover:bg-white/[0.06]', current && 'ring-accent/50')}>
                  {c.external ? (
                    <a href={c.external} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4" title="Эту главу издатель выкладывает только у себя на сайте">
                      {body}
                    </a>
                  ) : (
                    <button onClick={() => open(c.id)} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left">
                      {body}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!entry) save({})
                      toggleRead(id, [chapterKey(c)], !done)
                    }}
                    className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition', done ? 'bg-emerald-500/15 text-emerald-300' : 'text-white/25 hover:bg-white/10 hover:text-white')}
                    title={done ? 'Отметить непрочитанной' : 'Отметить прочитанной'}
                  >
                    <Check size={17} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
