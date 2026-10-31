import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Info, Scale, ShieldCheck, FileText, Activity, LifeBuoy, ChevronRight, ArrowLeft, Search, ExternalLink, Download } from 'lucide-react'
import { Panel, PanelTitle } from '../components/ui'
import { isElectron, isNative } from '../lib/platform'
import { SUPPORT_TELEGRAM, SUPPORT_URL, RELEASES_URL } from '../lib/links'
import licenses from '../generated/licenses.json'

const platform = isElectron ? 'Windows' : isNative ? (/android/i.test(navigator.userAgent) ? 'Android' : 'iPad') : 'Браузер'

function useVersion() {
  const [v, setV] = useState(__APP_VERSION__)
  useEffect(() => {
    window.aniplayer?.version?.().then(setV)
  }, [])
  return v
}

/** where the content comes from: the app only shows it */
const SOURCES: { name: string; what: string; url: string }[] = [
  { name: 'AniLibria', what: 'видео и озвучка аниме', url: 'https://anilibria.top' },
  { name: 'Шикимори', what: 'каталог аниме, описания, сезоны', url: 'https://shikimori.io' },
  { name: 'YummyAnime и Kodik', what: 'другие озвучки и недостающие серии', url: 'https://yummyani.me' },
  { name: 'AniSkip', what: 'отметки опенингов и эндингов', url: 'https://aniskip.com' },
  { name: 'AniList', what: 'синхронизация списка (по желанию)', url: 'https://anilist.co' },
  { name: 'MangaDex и Senkuro', what: 'манга и главы', url: 'https://mangadex.org' },
  { name: 'RanobeHub', what: 'ранобэ на русском', url: 'https://ranobehub.org' },
  { name: 'Baka-Tsuki', what: 'ранобэ на английском', url: 'https://www.baka-tsuki.org' },
  { name: 'Google Gemini', what: 'перевод манги и ранобэ вашим ключом', url: 'https://aistudio.google.com' },
  { name: 'Piper и F5-TTS', what: 'нейросетевая озвучка текста', url: 'https://github.com/rhasspy/piper' },
]

function Row({ to, href, icon, title, sub }: { to?: string; href?: string; icon: ReactNode; title: string; sub?: string }) {
  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{title}</span>
        {sub && <span className="block truncate text-sm font-semibold text-muted">{sub}</span>}
      </span>
      {href ? <ExternalLink size={16} className="text-muted" /> : <ChevronRight size={18} className="text-muted" />}
    </>
  )
  const cls = 'flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-white/5'
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <Link to={to!} className={cls}>
      {body}
    </Link>
  )
}

export default function About() {
  const { page } = useParams()
  if (page === 'licenses') return <Licenses />
  if (page === 'privacy') return <Doc title="Политика конфиденциальности" icon={<ShieldCheck className="text-emerald-400" />} body={PRIVACY} />
  if (page === 'terms') return <Doc title="Правила использования" icon={<FileText className="text-sky-400" />} body={TERMS} />
  return <AboutHome />
}

function AboutHome() {
  const version = useVersion()
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Panel>
        <div className="flex items-center gap-4">
          <img src="./icon-256.png" alt="" className="h-16 w-16 rounded-2xl" />
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">{isElectron ? 'Anyflow Desktop' : 'Anyflow'}</h1>
            <div className="text-sm font-semibold text-muted">
              Версия {version} · {platform}
            </div>
          </div>
        </div>
        <p className="mt-5 text-[15px] leading-relaxed text-white/80">
          Плеер аниме, читалка манги и ранобэ в одном приложении: история и прогресс на всех устройствах, озвучки AniLibria и других студий, перевод и
          озвучка текста нейросетью. Это неофициальный клиент: само приложение ничего не хранит и не раздаёт — оно показывает то, что открыто на сайтах-источниках.
        </p>
      </Panel>

      <Panel className="!p-3">
        <Row to="/status" icon={<Activity size={20} className="text-lime-400" />} title="Проверка соединения" sub="Какие источники отвечают и как быстро" />
        <Row href={SUPPORT_URL} icon={<LifeBuoy size={20} className="text-sky-400" />} title="Техподдержка" sub={SUPPORT_TELEGRAM ? 'Telegram' : 'Напишите на GitHub'} />
        <Row href={RELEASES_URL} icon={<Download size={20} className="text-accent-2" />} title="Все версии" sub="Windows и Android" />
        <Row to="/about/privacy" icon={<ShieldCheck size={20} className="text-emerald-400" />} title="Политика конфиденциальности" />
        <Row to="/about/terms" icon={<FileText size={20} className="text-sky-300" />} title="Правила использования" />
        <Row to="/about/licenses" icon={<Scale size={20} className="text-amber-300" />} title="Лицензии" sub={`${licenses.length} открытых библиотек`} />
      </Panel>

      <Panel>
        <PanelTitle icon={<Info className="text-accent-2" />} title="Источники" sub="Спасибо тем, без кого приложения бы не было" />
        <div className="grid gap-2 sm:grid-cols-2">
          {SOURCES.map((s) => (
            <a key={s.name} href={s.url} target="_blank" rel="noreferrer" className="rounded-2xl bg-white/[0.04] px-4 py-3 transition hover:bg-white/[0.08]">
              <div className="font-bold">{s.name}</div>
              <div className="text-sm font-semibold text-muted">{s.what}</div>
            </a>
          ))}
        </div>
      </Panel>
      <div className="pb-4 text-center text-xs text-dim">© 2026 Anyflow. Все права защищены.</div>
    </div>
  )
}

function Back() {
  return (
    <Link to="/about" className="flex items-center gap-2 self-start text-sm font-bold text-muted hover:text-white">
      <ArrowLeft size={16} /> О приложении
    </Link>
  )
}

function Licenses() {
  const [q, setQ] = useState('')
  const list = useMemo(() => licenses.filter((l) => !q || l.name.toLowerCase().includes(q.toLowerCase()) || l.license.toLowerCase().includes(q.toLowerCase())), [q])
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Back />
      <Panel>
        <PanelTitle icon={<Scale className="text-amber-300" />} title="Лицензии" sub="Открытые библиотеки внутри приложения" />
        <p className="mb-4 text-sm leading-relaxed text-white/70">
          Озвучка F5-TTS (русская модель Misha24-10) распространяется по лицензии CC BY-NC 4.0, голоса Piper — по лицензиям своих наборов данных. Шрифт Manrope — SIL
          Open Font License.
        </p>
        <label className="mb-3 flex h-11 items-center gap-2 rounded-full bg-card-2 px-4 ring-1 ring-white/5">
          <Search size={16} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию или лицензии" className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" />
        </label>
        <div className="flex flex-col divide-y divide-white/5">
          {list.map((l) => (
            <a key={l.name} href={l.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 py-2.5 hover:text-accent-2">
              <span className="min-w-0 truncate text-sm font-bold">
                {l.name} <span className="font-semibold text-muted">{l.version}</span>
              </span>
              <span className="shrink-0 rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs font-bold">{l.license}</span>
            </a>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function Doc({ title, icon, body }: { title: string; icon: ReactNode; body: [string, string][] }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Back />
      <Panel>
        <PanelTitle icon={icon} title={title} sub="Редакция от 1 ноября 2026" />
        <div className="flex flex-col gap-5">
          {body.map(([h, t]) => (
            <section key={h}>
              <h2 className="mb-1.5 text-lg font-extrabold">{h}</h2>
              <p className="text-[15px] leading-relaxed whitespace-pre-line text-white/80">{t}</p>
            </section>
          ))}
        </div>
      </Panel>
    </div>
  )
}

const PRIVACY: [string, string][] = [
  [
    'Что хранится на устройстве',
    'История просмотра и чтения, позиция в сериях, коллекция, настройки, скачанные серии и книги, ключи Gemini и токен AniList. На iPad и Android ключи и данные входа лежат в зашифрованном хранилище системы (Keychain / Keystore).',
  ],
  [
    'Что уходит в облако',
    'Если вы вошли в аккаунт: логин, прогресс серий, списки аниме и манги, статистика просмотра и общие настройки — чтобы они были одинаковыми на всех ваших устройствах. Пароль хранится только в виде хеша у провайдера аутентификации. Ключи Gemini в облако не отправляются.',
  ],
  [
    'Сторонние сервисы',
    'Видео, обложки, описания, главы и тексты загружаются напрямую с сайтов-источников (AniLibria, Шикимори, Kodik, MangaDex, RanobeHub и другие) — они видят ваш IP-адрес, как при обычном посещении сайта. Перевод отправляет текст страниц в Google Gemini с вашим ключом. AniList получает номер просмотренной серии, только если вы его подключили.',
  ],
  ['Что мы не делаем', 'Не показываем рекламу от себя, не продаём и не передаём данные третьим лицам, не используем трекеры и аналитику.'],
  ['Удаление', 'Данные на устройстве удаляются вместе с приложением или кнопкой «Очистить» в настройках. Чтобы удалить аккаунт и всё, что хранится в облаке, напишите в поддержку — скоро это будет одной кнопкой в профиле.'],
]

const TERMS: [string, string][] = [
  ['Что это', 'Anyflow — бесплатное неофициальное приложение для просмотра и чтения контента, опубликованного на сторонних сайтах. Приложение не размещает видео, манги или текстов на своих серверах.'],
  ['Права на контент', 'Права на аниме, мангу и ранобэ принадлежат их правообладателям, переводы — командам-переводчикам. Если вы правообладатель и хотите, чтобы источник перестал отображаться, напишите в поддержку.'],
  ['Аккаунт', 'Вы отвечаете за сохранность своего пароля. Не создавайте аккаунты от чужого имени и не используйте приложение для рассылки спама.'],
  ['Комментарии и профили', 'Запрещены оскорбления, спам, реклама, спойлеры без пометки, незаконный контент. Нарушения скрываются, аккаунты нарушителей блокируются.'],
  ['Без гарантий', 'Приложение предоставляется «как есть». Источники могут быть недоступны, а серии и главы — пропадать по решению сайтов-источников.'],
  ['Код приложения', 'Исходный код защищён авторским правом. Копировать, изменять и распространять его без разрешения автора нельзя.'],
]
