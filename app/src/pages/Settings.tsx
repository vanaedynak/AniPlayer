import { useEffect, useState, type ReactNode } from 'react'
import { Cloud, LogOut, Link2, PlayCircle, Database, Check, ExternalLink, Loader2, ZoomIn } from 'lucide-react'
import { useSync, getFirebaseConfig, saveFirebaseConfig, signIn, logOut, accountName } from '../lib/sync'
import { anilistViewer, anilistAuthUrl } from '../lib/anilist'
import { useStore } from '../lib/store'
import { Panel, PanelTitle } from '../components/ui'
import { UpdateSettings } from '../components/Updates'
import { cn } from '../lib/format'
import { SCALES } from '../lib/platform'

const input = 'h-12 w-full rounded-2xl bg-white/[0.06] px-4 font-semibold ring-1 ring-white/10 outline-none focus:ring-accent/60 placeholder:text-dim'
const btn = 'h-12 rounded-2xl px-5 font-bold transition disabled:opacity-50'

function Toggle({ label, hint, on, set }: { label: string; hint?: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button onClick={() => set(!on)} className="flex w-full items-center justify-between gap-6 rounded-2xl px-1 py-3 text-left">
      <span>
        <span className="block font-bold">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
      <span className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-accent' : 'bg-white/15')}>
        <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-6' : 'left-1')} />
      </span>
    </button>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/25 text-xs font-extrabold text-accent-2">{n}</span>
      <span className="text-sm leading-relaxed text-white/80">{children}</span>
    </li>
  )
}

function SyncSettings() {
  const { status, user, error } = useSync()
  const configured = !!getFirebaseConfig()
  const [cfg, setCfg] = useState('')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const go = async (register: boolean) => {
    setBusy(true)
    setMsg('')
    try {
      await signIn(email.trim(), pass, register)
    } catch (e) {
      const code = (e as { code?: string }).code ?? String(e)
      setMsg(
        code.includes('invalid-credential') || code.includes('wrong-password')
          ? 'Неверный логин или пароль'
          : code.includes('email-already-in-use')
            ? 'Такой аккаунт уже есть — нажмите «Войти» (или выберите другое имя)'
            : code.includes('bad-username')
              ? 'Имя: 3–24 символа, латиница, цифры, точка, «-» или «_»'
              : code.includes('invalid-email')
                ? 'Проверьте почту'
            : code.includes('weak-password')
              ? 'Пароль минимум 6 символов'
              : code,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel>
      <PanelTitle icon={<Cloud className="text-sky-400" />} title="Синхронизация" sub="История, позиция в серии, коллекция и статистика — между ПК и iPad" />
      {!configured ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-white/80">
            Подключите бесплатный проект Firebase (Google). Сделать это нужно один раз — инструкция в файле <b>SETUP.md</b>.
          </p>
          <textarea
            value={cfg}
            onChange={(e) => setCfg(e.target.value)}
            placeholder={'const firebaseConfig = {\n  apiKey: "...",\n  projectId: "...",\n  ...\n};'}
            className={cn(input, 'h-40 resize-none py-3 font-mono text-sm')}
          />
          <button
            className={cn(btn, 'self-start bg-white text-black')}
            onClick={() => {
              try {
                saveFirebaseConfig(cfg)
              } catch (e) {
                setMsg(String((e as Error).message))
              }
            }}
          >
            Сохранить конфиг
          </button>
        </div>
      ) : user ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-bold">{accountName(user)}</div>
            <div className={cn('text-sm font-semibold', status === 'synced' ? 'text-emerald-400' : status === 'error' ? 'text-rose-400' : 'text-yellow-400')}>
              {status === 'synced' ? 'Всё синхронизировано' : status === 'offline' ? 'Нет сети — изменения отправятся позже' : status === 'error' ? `Ошибка: ${error}` : 'Синхронизация…'}
            </div>
          </div>
          <button className={cn(btn, 'flex items-center gap-2 bg-white/10 hover:bg-white/15')} onClick={() => logOut()}>
            <LogOut size={18} /> Выйти
          </button>
        </div>
      ) : (
        <form
          className="flex max-w-md flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void go(false)
          }}
        >
          <p className="text-sm text-muted">Имя пользователя или почта — что удобнее. Войдите тем же логином на всех устройствах. Первый раз — «Создать аккаунт».</p>
          <input
            className={input}
            placeholder="Имя пользователя или почта"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <input className={input} type="password" placeholder="Пароль" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={cn(btn, 'flex-1 bg-white text-black')}>
              {busy ? <Loader2 className="mx-auto animate-spin" /> : 'Войти'}
            </button>
            <button type="button" disabled={busy} onClick={() => go(true)} className={cn(btn, 'flex-1 bg-white/10 hover:bg-white/15')}>
              Создать аккаунт
            </button>
          </div>
        </form>
      )}
      {msg && <div className="mt-3 text-sm font-semibold text-rose-400">{msg}</div>}
    </Panel>
  )
}

function AniListSettings() {
  const prefs = useStore((s) => s.prefs)
  const setPrefs = useStore((s) => s.setPrefs)
  const [token, setToken] = useState('')
  const [clientId, setClientId] = useState(() => localStorage.getItem('aniplayer-anilist-client') ?? '')
  const [viewer, setViewer] = useState<{ name: string; avatar: { medium: string } } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!prefs.anilistToken) return setViewer(null)
    anilistViewer(prefs.anilistToken)
      .then(setViewer)
      .catch((e) => setErr(String(e.message)))
  }, [prefs.anilistToken])

  return (
    <Panel>
      <PanelTitle icon={<Link2 className="text-sky-300" />} title="AniList" sub="Отмечать просмотренные серии в вашем списке AniList" />
      {prefs.anilistToken && viewer ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src={viewer.avatar.medium} alt="" className="h-12 w-12 rounded-full" />
              <div>
                <div className="font-bold">{viewer.name}</div>
                <div className="text-sm font-semibold text-emerald-400">Подключено</div>
              </div>
            </div>
            <button className={cn(btn, 'bg-white/10 hover:bg-white/15')} onClick={() => setPrefs({ anilistToken: '' })}>
              Отключить
            </button>
          </div>
          <Toggle label="Обновлять прогресс" hint="После просмотра серии номер серии уходит в AniList" on={prefs.anilistSync} set={(v) => setPrefs({ anilistSync: v })} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col gap-2">
            <Step n={1}>
              Откройте{' '}
              <a className="font-bold text-accent-2" href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer">
                anilist.co/settings/developer <ExternalLink size={12} className="inline" />
              </a>{' '}
              → Create New Client. Name: AniPlayer, Redirect URL: <code className="rounded bg-white/10 px-1">https://anilist.co/api/v2/oauth/pin</code>
            </Step>
            <Step n={2}>Скопируйте Client ID сюда и нажмите «Получить токен».</Step>
            <Step n={3}>Разрешите доступ, скопируйте показанный токен и вставьте ниже. Он синхронизируется на iPad сам.</Step>
          </ol>
          <div className="flex flex-wrap gap-2">
            <input
              className={cn(input, 'max-w-[220px]')}
              placeholder="Client ID"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value)
                localStorage.setItem('aniplayer-anilist-client', e.target.value)
              }}
            />
            <a
              href={clientId ? anilistAuthUrl(clientId.trim()) : undefined}
              target="_blank"
              rel="noreferrer"
              className={cn(btn, 'flex items-center gap-2 bg-white/10 hover:bg-white/15', !clientId && 'pointer-events-none opacity-50')}
            >
              Получить токен <ExternalLink size={16} />
            </a>
          </div>
          <div className="flex gap-2">
            <input className={input} placeholder="Вставьте токен" value={token} onChange={(e) => setToken(e.target.value)} />
            <button
              className={cn(btn, 'bg-white text-black')}
              disabled={!token.trim()}
              onClick={() => {
                setErr('')
                anilistViewer(token.trim())
                  .then(() => setPrefs({ anilistToken: token.trim(), anilistSync: true }))
                  .catch((e) => setErr('Токен не подошёл: ' + e.message))
              }}
            >
              Подключить
            </button>
          </div>
          {err && <div className="text-sm font-semibold text-rose-400">{err}</div>}
        </div>
      )}
    </Panel>
  )
}

function PlayerSettings() {
  const prefs = useStore((s) => s.prefs)
  const setPrefs = useStore((s) => s.setPrefs)
  return (
    <Panel>
      <PanelTitle icon={<PlayCircle className="text-accent-2" />} title="Плеер" sub="Настройки общие для всех устройств" />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 px-1 py-2">
        <span className="font-bold">Качество по умолчанию</span>
        <div className="flex gap-1 rounded-full bg-white/[0.06] p-1">
          {(['480', '720', '1080'] as const).map((q) => (
            <button key={q} onClick={() => setPrefs({ quality: q })} className={cn('rounded-full px-4 py-1.5 text-sm font-bold', prefs.quality === q ? 'bg-white text-black' : 'text-white/70')}>
              {q}p
            </button>
          ))}
        </div>
      </div>
      <Toggle label="Пропускать опенинг" hint="Через 5 секунд, если не нажать «Смотреть опенинг»" on={prefs.autoSkipOpening} set={(v) => setPrefs({ autoSkipOpening: v })} />
      <Toggle label="Пропускать эндинг" hint="Через 5 секунд сразу включается следующая серия" on={prefs.autoSkipEnding} set={(v) => setPrefs({ autoSkipEnding: v })} />
      <Toggle label="Автопереход к следующей серии" on={prefs.autoNext} set={(v) => setPrefs({ autoNext: v })} />
      <div className="mt-4 rounded-2xl bg-white/[0.03] p-4 text-sm text-muted ring-1 ring-white/5">
        <b className="text-white/80">Горячие клавиши:</b> Пробел/K — пауза · ←/→ — 5 сек · J/L — 10 сек · ↑/↓ — громкость · F — полный экран · M — звук · N — след. серия · S — пропустить опенинг · 0–9 — перейти к %
      </div>
    </Panel>
  )
}

function InterfaceSettings() {
  const scale = useStore((s) => s.local.scale)
  const setLocal = useStore((s) => s.setLocal)
  return (
    <Panel>
      <PanelTitle icon={<ZoomIn className="text-pink" />} title="Интерфейс" sub="Масштаб для этого устройства" />
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <span className="font-bold">Масштаб</span>
        <div className="flex flex-wrap gap-1 rounded-full bg-white/[0.06] p-1">
          {SCALES.map((sc) => (
            <button
              key={sc}
              onClick={() => setLocal({ scale: sc })}
              className={cn('rounded-full px-3.5 py-1.5 text-sm font-bold', scale === sc ? 'bg-white text-black' : 'text-white/70 hover:text-white')}
            >
              {Math.round(sc * 100)}%
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 px-1 text-sm text-muted">На компьютере также работают Ctrl + плюс / минус / 0.</div>
    </Panel>
  )
}

function DataSettings() {
  const [done, setDone] = useState(false)
  const exportData = () => {
    const s = useStore.getState()
    const blob = new Blob([JSON.stringify({ progress: s.progress, titles: s.titles, statsDays: s.statsDays }, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `aniplayer-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setDone(true)
  }
  return (
    <Panel>
      <PanelTitle icon={<Database className="text-emerald-400" />} title="Данные" />
      <button onClick={exportData} className={cn(btn, 'flex items-center gap-2 bg-white/10 hover:bg-white/15')}>
        {done ? <Check size={18} /> : null} Скачать резервную копию
      </button>
    </Panel>
  )
}

export default function Settings() {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Настройки</h1>
      <UpdateSettings />
      <SyncSettings />
      <InterfaceSettings />
      <AniListSettings />
      <PlayerSettings />
      <DataSettings />
      <div className="px-2 text-xs text-dim">AniPlayer · видео и озвучка AniLibria (anilibria.top) · неофициальный клиент для личного использования</div>
    </div>
  )
}
