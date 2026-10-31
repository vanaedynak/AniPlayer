import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowLeft, RefreshCw, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Loader2, LifeBuoy } from 'lucide-react'
import { Panel, PanelTitle } from '../components/ui'
import { api } from '../lib/api'
import { useSync } from '../lib/sync'
import { useManga } from '../manga/store'
import { getText } from '../ranobe/sources'
import { mdPing } from '../manga/md'
import { isElectron } from '../lib/platform'
import { SUPPORT_URL } from '../lib/links'
import { cn } from '../lib/format'

type Result = { ok: boolean | null; ms?: number; note?: string }
interface Check {
  id: string
  name: string
  what: string
  run: () => Promise<string | void>
}

const SLOW_MS = 1500
const TIMEOUT_MS = 12_000

async function ok(url: string, init?: RequestInit) {
  const r = await fetch(url, init)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r
}

/** every source the app talks to, checked the way the app itself reaches it */
function checks(): Check[] {
  const keys = useManga.getState().prefs.geminiKeys.filter((k) => k.trim())
  const list: Check[] = [
    { id: 'libria', name: 'AniLibria', what: 'каталог и серии', run: async () => void (await api.latest(1)) },
    {
      id: 'libria-video',
      name: 'Видео AniLibria',
      what: 'сервер с самими сериями',
      run: async () => {
        const r = (await api.latest(3)).find((x) => x.latest_episode?.hls_480 || x.latest_episode?.hls_720)
        const url = r?.latest_episode?.hls_480 || r?.latest_episode?.hls_720
        if (!url) return 'нет свежих серий для проверки'
        await ok(url)
      },
    },
    { id: 'shiki', name: 'Шикимори', what: 'каталог, сезоны, постеры', run: async () => void (await ok('https://shikimori.io/api/animes?limit=1')) },
    { id: 'yummy', name: 'YummyAnime', what: 'другие озвучки', run: async () => void (await ok('https://api.yani.tv/search?q=naruto&limit=1')) },
    {
      id: 'kodik',
      name: 'Kodik',
      what: 'плеер других озвучек',
      // the player sends no CORS headers: an opaque answer is enough to know it is reachable
      run: async () => void (await fetch('https://kodikplayer.com/favicon.ico', { mode: 'no-cors', cache: 'no-store' })),
    },
    { id: 'aniskip', name: 'AniSkip', what: 'пропуск опенингов', run: async () => void (await fetch('https://api.aniskip.com/v2/skip-times/21/1?types[]=op&episodeLength=0')) },
    { id: 'mangadex', name: 'MangaDex', what: 'манга', run: async () => void (await mdPing()) },
    { id: 'ranobehub', name: 'RanobeHub', what: 'ранобэ на русском', run: async () => void (await getText('https://ranobehub.org/api/search?q=a', { from: 'https://ranobehub.org', to: '/ranobehub' })) },
    { id: 'bakatsuki', name: 'Baka-Tsuki', what: 'ранобэ на английском', run: async () => void (await ok('https://www.baka-tsuki.org/project/api.php?action=query&meta=siteinfo&format=json&origin=*')) },
    {
      id: 'anilist',
      name: 'AniList',
      what: 'синхронизация списка',
      run: async () =>
        void (await ok('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ Media(id: 1) { id } }' }) })),
    },
    {
      id: 'sync',
      name: 'Синхронизация',
      what: 'аккаунт и прогресс',
      run: async () => {
        const { status, error } = useSync.getState()
        if (status === 'disabled') return 'не настроена'
        if (status === 'signed-out') return 'вы не вошли'
        if (status === 'error') throw new Error(error || 'ошибка')
        if (status === 'offline') throw new Error('нет связи')
      },
    },
    { id: 'github', name: 'Обновления', what: 'новые версии', run: async () => void (await ok('https://api.github.com/repos/vanaedynak/AniPlayer/releases/latest')) },
  ]
  keys.forEach((k, i) =>
    list.push({
      id: `gemini-${i}`,
      name: `Gemini, ключ ${i + 1}`,
      what: `…${k.trim().slice(-4)}`,
      run: async () => {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(k.trim())}`)
        if (r.status === 400 || r.status === 403) throw new Error('ключ не подходит')
        if (r.status === 429) throw new Error('лимит на сегодня исчерпан')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
      },
    }),
  )
  if (isElectron)
    list.push({
      id: 'f5',
      name: 'Голосовой модуль F5',
      what: 'озвучка на видеокарте',
      run: async () => {
        const h = await fetch('http://127.0.0.1:47917/health')
          .then((r) => r.json() as Promise<{ ok: boolean }>)
          .catch(() => null)
        if (!h) return 'запустится при первой озвучке'
        if (!h.ok) return 'загружается'
      },
    })
  return list
}

async function measure(c: Check): Promise<Result> {
  const t = performance.now()
  try {
    const note = await Promise.race([c.run(), new Promise<never>((_, no) => setTimeout(() => no(new Error('нет ответа')), TIMEOUT_MS))])
    return note ? { ok: null, note } : { ok: true, ms: Math.round(performance.now() - t) }
  } catch (e) {
    return { ok: false, note: String((e as Error)?.message ?? e) }
  }
}

export default function Status() {
  const [list] = useState(checks)
  const [res, setRes] = useState<Record<string, Result>>({})
  const [busy, setBusy] = useState(false)

  const run = useCallback(() => {
    setBusy(true)
    setRes({})
    void Promise.all(list.map((c) => measure(c).then((r) => setRes((cur) => ({ ...cur, [c.id]: r }))))).finally(() => setBusy(false))
  }, [list])
  useEffect(run, [run])

  const failed = list.filter((c) => res[c.id]?.ok === false).length
  const slow = list.filter((c) => (res[c.id]?.ms ?? 0) > SLOW_MS).length

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link to="/about" className="flex items-center gap-2 self-start text-sm font-bold text-muted hover:text-white">
        <ArrowLeft size={16} /> О приложении
      </Link>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PanelTitle
            icon={<Activity className="text-lime-400" />}
            title="Проверка соединения"
            sub={busy ? 'Проверяем…' : failed ? `Не отвечает: ${failed}` : slow ? `Всё работает, медленно: ${slow}` : 'Всё работает'}
          />
          <button onClick={run} disabled={busy} className="flex h-11 items-center gap-2 rounded-full bg-white/10 px-5 font-bold hover:bg-white/15 disabled:opacity-50">
            <RefreshCw size={16} className={busy ? 'animate-spin' : undefined} /> Ещё раз
          </button>
        </div>
        <div className="flex flex-col divide-y divide-white/5">
          {list.map((c) => {
            const r = res[c.id]
            const slowOne = (r?.ms ?? 0) > SLOW_MS
            return (
              <div key={c.id} className="flex items-center gap-3 py-3">
                {!r ? (
                  <Loader2 size={20} className="shrink-0 animate-spin text-muted" />
                ) : r.ok === false ? (
                  <XCircle size={20} className="shrink-0 text-rose-400" />
                ) : r.ok === null ? (
                  <MinusCircle size={20} className="shrink-0 text-muted" />
                ) : slowOne ? (
                  <AlertTriangle size={20} className="shrink-0 text-amber-300" />
                ) : (
                  <CheckCircle2 size={20} className="shrink-0 text-lime-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{c.name}</div>
                  <div className="truncate text-sm font-semibold text-muted">{c.what}</div>
                </div>
                <div className={cn('shrink-0 text-right text-sm font-bold tabular-nums', r?.ok === false ? 'text-rose-300' : slowOne ? 'text-amber-200' : 'text-white/70')}>
                  {r ? (r.ms != null ? `${r.ms} мс` : r.note) : ''}
                </div>
              </div>
            )
          })}
        </div>
        {failed > 0 && !busy && (
          <div className="mt-4 rounded-2xl bg-white/[0.04] p-4 text-sm leading-relaxed text-white/75">
            Если не отвечает один источник — скорее всего, проблема у него, и через время всё заработает. Если не отвечает почти всё — проверьте интернет или VPN. Не
            помогло?{' '}
            <a href={SUPPORT_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-accent-2">
              <LifeBuoy size={14} /> Напишите в поддержку
            </a>
          </div>
        )}
      </Panel>
    </div>
  )
}
