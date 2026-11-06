import { BatteryLow, BookOpen, Eye, Moon, Monitor, RotateCcw, Sparkles } from 'lucide-react'
import { useManga, type Ambience, type BookPrefs, type Paper } from '../manga/store'
import { PAPER } from '../manga/ui'
import { Sheet, Field, Seg, Toggle } from '../manga/Reader'
import { cn } from '../lib/format'
import { FONTS, MARGINS, type BookFont } from './bookLook'
import { LIGHTS, SOUNDS, TEXTURES } from './Ambience'
import { usePower } from '../lib/power'

/** the paper colours, each shown as a little page */
export function PaperPicker({ value, set }: { value: Paper; set: (p: Paper) => void }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {(Object.keys(PAPER) as Paper[]).map((k) => (
        <button
          key={k}
          onClick={() => set(k)}
          className={cn('flex flex-col items-center gap-1 rounded-xl p-1.5 text-[10px] leading-tight font-bold ring-1', value === k ? 'ring-2 ring-accent-2' : 'ring-white/10 hover:ring-white/30')}
        >
          <span className="flex h-9 w-full items-center justify-center rounded-lg font-serif text-sm ring-1 ring-white/10" style={{ background: PAPER[k].bg, color: PAPER[k].fg }}>
            Аа
          </span>
          {PAPER[k].label}
        </button>
      ))}
    </div>
  )
}

/** texture, light, warmth, dimming and the room's sound: the same for manga and books */
export function AmbienceControls() {
  const a = useManga((s) => s.amb)
  const set = useManga((s) => s.setAmb)
  return (
    <>
      <Field label="Текстура бумаги">
        <Seg value={a.texture} onChange={(texture) => set({ texture })} options={TEXTURES} />
      </Field>
      <Field label="Освещение">
        <Seg value={a.light} onChange={(light) => set({ light })} options={LIGHTS} />
      </Field>
      <Field label={`Тёплый свет · ${Math.round(a.warmth * 100)}%`}>
        <input type="range" min={0} max={1} step={0.05} value={a.warmth} onChange={(e) => set({ warmth: Number(e.target.value) })} className="w-full accent-amber-400" />
        <div className="mt-1 text-[11px] text-white/45">Убирает синий свет, как лампа вечером: глаза меньше устают</div>
      </Field>
      <Field label={`Приглушить · ${Math.round(a.dim * 100)}%`}>
        <input type="range" min={0} max={0.7} step={0.05} value={a.dim} onChange={(e) => set({ dim: Number(e.target.value) })} className="w-full accent-accent-2" />
      </Field>
      <Field label="Звук вокруг">
        <Seg value={a.sound} onChange={(sound) => set({ sound })} options={SOUNDS} />
        {a.sound !== 'off' && (
          <input type="range" min={0.05} max={1} step={0.05} value={a.volume} onChange={(e) => set({ volume: Number(e.target.value) })} className="mt-3 w-full accent-accent-2" aria-label="Громкость" />
        )}
      </Field>
    </>
  )
}

type Preset = { id: string; label: string; hint: string; icon: typeof BookOpen; book: Partial<BookPrefs>; amb: Partial<Ambience> }

const PRESETS: Preset[] = [
  {
    id: 'book',
    label: 'Бумажная книга',
    hint: 'кремовая бумага, Literata, лампа',
    icon: BookOpen,
    book: { paper: 'cream', font: 'literata', paged: true, curl: true, flipSound: true, justify: true, indent: true, dropCap: true, runningHead: true, softText: false, weight: 400 },
    amb: { texture: 'paper', light: 'lamp', warmth: 0.1, dim: 0 },
  },
  {
    id: 'eyes',
    label: 'Бережём глаза',
    hint: 'мягкий контраст, тёплый свет, воздух',
    icon: Eye,
    book: { paper: 'sepia', font: 'literata', leading: 1.85, para: 0.5, softText: true, weight: 420, margins: 'wide' },
    amb: { texture: 'paper', light: 'none', warmth: 0.35, dim: 0 },
  },
  {
    id: 'night',
    label: 'Ночное чтение',
    hint: 'тёмная бумага, без синего, тише',
    icon: Moon,
    book: { paper: 'night', softText: true, weight: 380 },
    amb: { texture: 'old', light: 'lamp', warmth: 0.45, dim: 0.15 },
  },
  {
    id: 'eink',
    label: 'Электронная книга',
    hint: 'матовый серый, чёткий шрифт',
    icon: Monitor,
    book: { paper: 'eink', font: 'pt', softText: false, weight: 450, curl: false },
    amb: { texture: 'none', light: 'none', warmth: 0, dim: 0 },
  },
  {
    id: 'old',
    label: 'Старый томик',
    hint: 'пожелтевшие страницы, камин',
    icon: Sparkles,
    book: { paper: 'old', font: 'pt', dropCap: true, runningHead: true, softText: false },
    amb: { texture: 'old', light: 'lamp', warmth: 0.2, sound: 'fire' },
  },
]

/** power saving for long reading on battery; it applies only while a reader is open */
export function PowerSaveCard() {
  const { save, setSave } = usePower()
  return (
    <div className={cn('rounded-2xl px-4 py-3 ring-1', save ? 'bg-emerald-400/10 ring-emerald-300/30' : 'bg-white/5 ring-white/10')}>
      <button onClick={() => setSave(!save)} className="flex w-full items-center gap-3 text-left">
        <BatteryLow size={22} className={cn('shrink-0', save ? 'text-emerald-300' : 'text-white/60')} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold">Экономия энергии</span>
          <span className="block text-xs text-white/55">Без анимаций, звуков, текстур и загрузок в фоне, страницы листаются сразу</span>
        </span>
        <span className={cn('relative h-7 w-12 shrink-0 rounded-full', save ? 'bg-emerald-400' : 'bg-white/15')}>
          <span className={cn('absolute top-1 h-5 w-5 rounded-full bg-white', save ? 'left-6' : 'left-1')} />
        </span>
      </button>
      {save && (
        <div className="mt-2 text-xs leading-snug text-white/55">
          Больше всего батареи тратит экран: убавьте яркость в Пункте управления и включите авто-блокировку. Тёмная бумага помогает только на iPad с OLED-экраном.
        </div>
      )}
    </div>
  )
}

/** everything about how a book reads: ready looks, text, pages, paper, light and sound */
export function BookSheet({
  prefs,
  set,
  close,
  onTranslator,
  canPage = true,
}: {
  prefs: BookPrefs
  set: (p: Partial<BookPrefs>) => void
  close: () => void
  onTranslator?: () => void
  canPage?: boolean
}) {
  const setAmb = useManga((s) => s.setAmb)
  const stats = useManga((s) => s.pagesRead)
  const today = stats.day === new Date().toDateString() ? stats.today : 0
  const wide = window.innerWidth >= 640
  return (
    <Sheet title="Оформление" close={close}>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-accent/25 to-accent-2/10 px-4 py-3 ring-1 ring-white/10">
          <BookOpen size={22} className="shrink-0 text-accent-2" />
          <div className="text-sm leading-snug">
            <div className="font-extrabold">Сегодня: {today} стр.</div>
            <div className="text-xs text-white/55">Всего перевёрнуто {stats.total} страниц</div>
          </div>
        </div>

        <PowerSaveCard />

        <Field label="Готовые настройки">
          <div className="grid grid-cols-1 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  set(p.book)
                  setAmb(p.amb)
                }}
                className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5 text-left ring-1 ring-white/10 transition hover:bg-white/10"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold" style={{ background: PAPER[p.book.paper as Paper]?.bg, color: PAPER[p.book.paper as Paper]?.fg }}>
                  <p.icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-extrabold">{p.label}</span>
                  <span className="block truncate text-xs text-white/50">{p.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </Field>

        {canPage && (
          <Field label="Как листать">
            <Seg
              value={prefs.paged === false ? 'scroll' : 'pages'}
              onChange={(v) => set({ paged: v === 'pages' })}
              options={[
                { v: 'pages', l: 'Страницы', hint: 'как в книге' },
                { v: 'scroll', l: 'Лента', hint: 'вниз без конца' },
              ]}
            />
          </Field>
        )}
        {canPage && prefs.paged !== false && (
          <>
            {wide && (
              <Field label="На экране">
                <Seg
                  value={prefs.spread ?? 'auto'}
                  onChange={(spread) => set({ spread })}
                  options={[
                    { v: 'auto', l: 'Сам', hint: 'по ширине' },
                    { v: 'one', l: 'Одна', hint: 'страница' },
                    { v: 'two', l: 'Разворот', hint: 'две рядом' },
                  ]}
                />
              </Field>
            )}
            <Toggle label="Страница переворачивается как бумажная" value={prefs.curl !== false} onChange={(curl) => set({ curl })} />
            <Toggle label="Шелест страниц" value={prefs.flipSound !== false} onChange={(flipSound) => set({ flipSound })} />
            <Toggle label="Колонтитулы (название наверху страниц)" value={prefs.runningHead !== false} onChange={(runningHead) => set({ runningHead })} />
            <div className="-mt-3 text-xs text-white/50">Касание у правого края — дальше, у левого — назад, в центре — меню. Страницу можно тянуть за край пальцем.</div>
          </>
        )}

        <Field label={`Размер текста · ${prefs.size}px`}>
          <div className="flex items-center gap-3">
            <button onClick={() => set({ size: Math.max(13, prefs.size - 1) })} className="h-10 w-10 rounded-full bg-white/10 text-sm font-extrabold">
              A−
            </button>
            <input type="range" min={13} max={34} value={prefs.size} onChange={(e) => set({ size: Number(e.target.value) })} className="flex-1 accent-accent-2" />
            <button onClick={() => set({ size: Math.min(34, prefs.size + 1) })} className="h-10 w-10 rounded-full bg-white/10 text-lg font-extrabold">
              A+
            </button>
          </div>
        </Field>
        <Field label="Шрифт">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(FONTS) as BookFont[]).map((k) => (
              <button
                key={k}
                onClick={() => set({ font: k })}
                className={cn('rounded-xl px-3 py-2 text-left ring-1 transition', prefs.font === k ? 'bg-white text-black ring-white' : 'bg-white/5 ring-white/10 hover:bg-white/10')}
              >
                <span className="block text-lg leading-tight" style={{ fontFamily: FONTS[k].css }}>
                  {FONTS[k].label}
                </span>
                <span className={cn('block text-[10px] font-semibold', prefs.font === k ? 'text-black/55' : 'text-white/45')}>{FONTS[k].hint}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label={`Насыщенность · ${prefs.weight ?? 400}`}>
          <input type="range" min={300} max={600} step={10} value={prefs.weight ?? 400} onChange={(e) => set({ weight: Number(e.target.value) })} className="w-full accent-accent-2" />
        </Field>
        <Field label={`Межстрочный интервал · ${prefs.leading.toFixed(2)}`}>
          <input type="range" min={1.2} max={2.3} step={0.05} value={prefs.leading} onChange={(e) => set({ leading: Number(e.target.value) })} className="w-full accent-accent-2" />
        </Field>
        <Field label={`Между абзацами · ${(prefs.para ?? 0.3).toFixed(1)}`}>
          <input type="range" min={0} max={1.4} step={0.1} value={prefs.para ?? 0.3} onChange={(e) => set({ para: Number(e.target.value) })} className="w-full accent-accent-2" />
        </Field>
        <Field label="Поля страницы">
          <Seg value={prefs.margins ?? 'normal'} onChange={(margins) => set({ margins })} options={(Object.keys(MARGINS) as (keyof typeof MARGINS)[]).map((k) => ({ v: k, l: MARGINS[k].label }))} />
        </Field>
        {(!canPage || prefs.paged === false || (prefs.spread ?? 'auto') !== 'two') && (
          <Field label={`Ширина текста · ${prefs.width}px`}>
            <input type="range" min={420} max={1200} step={20} value={prefs.width} onChange={(e) => set({ width: Number(e.target.value) })} className="w-full accent-accent-2" />
          </Field>
        )}
        <Toggle label="Выравнивание по ширине" value={prefs.justify} onChange={(justify) => set({ justify })} />
        <Toggle label="Красная строка" value={prefs.indent} onChange={(indent) => set({ indent })} />
        <Toggle label="Буквица в начале главы" value={prefs.dropCap !== false} onChange={(dropCap) => set({ dropCap })} />
        <Toggle label="Мягкий контраст текста" value={!!prefs.softText} onChange={(softText) => set({ softText })} />

        <Field label="Бумага">
          <PaperPicker value={prefs.paper} set={(paper) => set({ paper })} />
        </Field>
        <AmbienceControls />

        <button
          onClick={() => {
            set({ size: 19, leading: 1.7, font: 'literata', width: 720, justify: true, indent: true, margins: 'normal', weight: 400, para: 0.3, dropCap: true, runningHead: true, softText: false, curl: true, flipSound: true })
            setAmb({ texture: 'none', light: 'none', warmth: 0, dim: 0, sound: 'off' })
          }}
          className="flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-bold text-white/60 hover:bg-white/10 hover:text-white"
        >
          <RotateCcw size={15} /> Сбросить оформление
        </button>
        {onTranslator && (
          <button onClick={onTranslator} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white/10 text-sm font-bold hover:bg-white/15">
            Переводчик и словарик имён
          </button>
        )}
      </div>
    </Sheet>
  )
}
