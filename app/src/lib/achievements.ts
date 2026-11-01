// Achievements: earned from the numbers the server counts (profile_stats). General ones grow with time
// watched, episodes, reading, streaks and community; series ones need a title finished (by its MAL id).
// Themed ones (lib/themed) follow one anime episode by episode. Some carry a reward: a unique theme opens with them.
import type { ProfileStats } from './social'
import { levelOf } from './social'
import { THEMED } from './themed'

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
export type Category = 'watch' | 'read' | 'streak' | 'community' | 'theme' | 'series' | 'special'

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'watch', label: 'Просмотр' },
  { id: 'read', label: 'Чтение' },
  { id: 'streak', label: 'Серии дней' },
  { id: 'community', label: 'Сообщество' },
  { id: 'theme', label: 'Тематические' },
  { id: 'series', label: 'Аниме' },
  { id: 'special', label: 'Особые' },
]

export const RARITY: Record<Rarity, { label: string; color: string }> = {
  common: { label: 'Обычное', color: '#94a3b8' },
  rare: { label: 'Редкое', color: '#38bdf8' },
  epic: { label: 'Эпическое', color: '#c084fc' },
  legendary: { label: 'Легендарное', color: '#fbbf24' },
}

export interface Achievement {
  id: string
  category: Category
  icon: string
  label: string
  hint: string
  rarity: Rarity
  goal: number
  value: (s: Stats) => number
  /** the longer story, shown when the achievement is opened */
  about?: string
  /** the anime it belongs to */
  anime?: string
  /** what it opens */
  reward?: { theme: string }
}
export type Stats = ProfileStats & { created_at: string }

const ladder = (
  category: Category,
  prefix: string,
  value: (s: Stats) => number,
  steps: [goal: number, icon: string, label: string, hint: string, rarity: Rarity, theme?: string][],
): Achievement[] =>
  steps.map(([goal, icon, label, hint, rarity, theme]) => ({ id: `${prefix}${goal}`, category, icon, label, hint, rarity, goal, value, reward: theme ? { theme } : undefined }))

const minutes = (s: Stats) => Math.floor(s.seconds / 60)
const hours = (s: Stats) => Math.floor(s.seconds / 3600)
const readHours = (s: Stats) => Math.floor(s.read_seconds / 3600)
const has = (s: Stats, ids: number[]) => ids.filter((id) => s.completed_ids?.includes(id)).length

// a finished series: any of its ids (the first season, or the whole thing when goal is the number of ids)
const series = (id: string, icon: string, label: string, title: string, ids: number[], rarity: Rarity = 'rare', all = false): Achievement => ({
  id: `s-${id}`,
  category: 'series',
  icon,
  label,
  hint: all ? `Досмотреть все сезоны «${title}»` : `Досмотреть «${title}»`,
  about: all ? `Все сезоны «${title}» в списке просмотренных. Историю целиком проходят немногие.` : `«${title}» в списке просмотренных. Одно из тех аниме, которые стоит увидеть хотя бы раз.`,
  anime: title,
  rarity,
  goal: all ? ids.length : 1,
  value: (s) => has(s, ids),
})

export const ACHIEVEMENTS: Achievement[] = [
  ...ladder('watch', 'min', minutes, [
    [60, '🎬', 'Первый час', 'Посмотреть 60 минут', 'common'],
    [600, '⏱️', 'Втянулся', 'Посмотреть 10 часов', 'common'],
    [3000, '🍿', 'Ещё одну серию', 'Посмотреть 50 часов', 'rare', 'scouts'],
    [5000, '📺', '5000 минут', 'Посмотреть 5000 минут', 'rare'],
  ]),
  ...ladder('watch', 'h', hours, [
    [100, '🔥', 'Сотня часов', 'Посмотреть 100 часов', 'rare'],
    [250, '🌙', 'Ночи напролёт', 'Посмотреть 250 часов', 'epic'],
    [500, '🌌', 'Живёт в аниме', 'Посмотреть 500 часов', 'epic'],
    [1000, '🪐', 'Тысяча часов', 'Посмотреть 1000 часов', 'legendary'],
  ]),
  ...ladder('watch', 'ep', (s) => s.episodes, [
    [1, '▶️', 'Первые шаги', 'Досмотреть первую серию', 'common'],
    [10, '🎞️', 'Десяточка', '10 серий', 'common'],
    [50, '📼', 'Полсотни', '50 серий', 'common'],
    [100, '🏃', 'Марафонец', '100 серий', 'rare', 'shinigami'],
    [250, '🚀', 'Без остановок', '250 серий', 'rare'],
    [500, '⚔️', 'Ветеран', '500 серий', 'epic'],
    [1000, '👑', 'Легенда', '1000 серий', 'legendary', 'grandline'],
    [2500, '🐉', 'Бессмертный зритель', '2500 серий', 'legendary'],
  ]),
  ...ladder('watch', 'done', (s) => s.completed, [
    [1, '✅', 'Первый тайтл', 'Досмотреть 1 аниме', 'common'],
    [5, '🧩', 'Коллекционер', 'Досмотреть 5 аниме', 'common'],
    [10, '🗡️', 'Закрываю гештальты', 'Досмотреть 10 аниме', 'rare', 'slayer'],
    [25, '🏯', 'Знаток', 'Досмотреть 25 аниме', 'rare'],
    [50, '📜', 'Отаку', 'Досмотреть 50 аниме', 'epic'],
    [100, '🏆', 'Сэнсэй', 'Досмотреть 100 аниме', 'legendary'],
  ]),

  ...ladder('read', 'ch', (s) => s.chapters, [
    [1, '📖', 'Первая глава', 'Дочитать главу манги', 'common'],
    [50, '🔖', 'Читатель', '50 глав манги', 'common'],
    [100, '📕', 'Книжный червь', '100 глав манги', 'rare', 'cursed'],
    [500, '📚', 'Мангака в душе', '500 глав манги', 'epic'],
    [1000, '🗄️', 'Библиотека', '1000 глав манги', 'legendary'],
  ]),
  ...ladder('read', 'ln', (s) => s.ln_chapters, [
    [1, '📗', 'Новелла', 'Дочитать главу ранобэ', 'common'],
    [25, '🪶', 'Любитель историй', '25 глав ранобэ', 'common'],
    [50, '📚', 'Ранобэ-гуру', '50 глав ранобэ', 'rare', 'isekai'],
    [200, '🌀', 'Переродился в книге', '200 глав ранобэ', 'epic'],
    [500, '🧙', 'Хранитель свитков', '500 глав ранобэ', 'legendary'],
  ]),
  ...ladder('read', 'rh', readHours, [
    [1, '☕', 'Час с книгой', 'Читать 1 час', 'common'],
    [10, '🕯️', 'Вечера за чтением', 'Читать 10 часов', 'rare'],
    [50, '🦉', 'Ночной читатель', 'Читать 50 часов', 'epic'],
    [100, '🏛️', 'Великий книжник', 'Читать 100 часов', 'legendary'],
  ]),

  ...ladder('streak', 'st', (s) => s.best_streak, [
    [3, '✨', 'Разогрев', '3 дня подряд', 'common'],
    [7, '⚡', 'В ударе', '7 дней подряд', 'rare', 'leaf'],
    [14, '🌊', 'Две недели', '14 дней подряд', 'rare'],
    [30, '💎', 'Железная воля', '30 дней подряд', 'epic'],
    [100, '🌋', 'Сто дней', '100 дней подряд', 'legendary'],
    [365, '🌞', 'Целый год', '365 дней подряд', 'legendary'],
  ]),

  ...ladder('community', 'rt', (s) => s.ratings, [
    [1, '⭐', 'Первая оценка', 'Оценить аниме', 'common'],
    [10, '🎯', 'Критик', '10 оценок', 'common'],
    [50, '🧐', 'Эксперт', '50 оценок', 'rare'],
    [100, '🏅', 'Главный критик', '100 оценок', 'epic'],
  ]),
  ...ladder('community', 'cm', (s) => s.comments, [
    [1, '💬', 'Первое слово', 'Написать комментарий', 'common'],
    [10, '🗣️', 'Голос сообщества', '10 комментариев', 'common'],
    [50, '📣', 'Активист', '50 комментариев', 'rare'],
    [200, '🎙️', 'Легенда обсуждений', '200 комментариев', 'epic'],
  ]),

  // famous series, by MAL id
  series('aot', '🧱', 'За стенами', 'Атака титанов', [16498], 'rare'),
  series('aot-all', '🕊️', 'Конец истории', 'Атака титанов', [16498, 25777, 35760, 38524, 40028], 'legendary', true),
  series('naruto', '🍥', 'Путь ниндзя', 'Наруто', [20], 'rare'),
  series('shippuden', '🌀', 'Воля огня', 'Наруто: Ураганные хроники', [1735], 'epic'),
  series('bleach', '🌕', 'Банкай', 'Блич', [269], 'rare'),
  series('tybw', '⚔️', 'Тысячелетняя война', 'Блич: Тысячелетняя кровавая война', [41467], 'epic'),
  series('kny', '🌸', 'Дыхание солнца', 'Клинок, рассекающий демонов', [38000], 'rare'),
  series('jjk', '🟣', 'Расширение территории', 'Магическая битва', [40748], 'rare'),
  series('onepiece', '🏴‍☠️', 'Король пиратов', 'Ван-Пис', [21], 'legendary'),
  series('deathnote', '📓', 'Я — справедливость', 'Тетрадь смерти', [1535]),
  series('fmab', '⚗️', 'Равноценный обмен', 'Стальной алхимик: Братство', [5114]),
  series('steinsgate', '🧪', 'Эль Псай Конгру', 'Врата Штейна', [9253]),
  series('codegeass', '♟️', 'Сила королей', 'Код Гиас', [1575]),
  series('hxh', '🃏', 'Охотник', 'Охотник х Охотник', [11061]),
  series('csm', '🪚', 'Охотник на демонов', 'Человек-бензопила', [44511]),
  series('spyfamily', '🥜', 'Операция «Стрикс»', 'Семья шпиона', [50265]),
  series('frieren', '🌿', 'После конца пути', 'Провожающая в последний путь Фрирен', [52991], 'epic'),
  series('eva', '🤖', 'Не убегай', 'Евангелион', [30]),
  series('ghoul', '🎭', 'Гуль', 'Токийский гуль', [22319]),
  series('mha', '💥', 'Плюс ультра', 'Моя геройская академия', [31964]),
  series('sao', '🗡️', 'Линк старт', 'Мастера меча онлайн', [11757]),
  series('opm', '👊', 'Один удар', 'Ванпанчмен', [30276]),
  series('rezero', '⏳', 'Возвращение смертью', 'Re:Zero', [31240]),
  series('mob', '💯', 'Сто процентов', 'Моб Психо 100', [32182]),
  series('bebop', '🎷', 'See you, space cowboy', 'Ковбой Бибоп', [1]),
  series('yourname', '☄️', 'Нить судьбы', 'Твоё имя', [32281]),
  series('vinland', '🛶', 'Нет врагов', 'Сага о Винланде', [37521]),
  series('sololeveling', '🗝️', 'Восстань', 'Поднятие уровня в одиночку', [52299]),
  series('drstone', '🧫', 'Десять миллиардов процентов', 'Доктор Стоун', [38691]),
  series('haikyuu', '🏐', 'Через сетку', 'Волейбол!!', [20583]),
  series('mushoku', '🧭', 'На этот раз всерьёз', 'Реинкарнация безработного', [39535]),

  ...THEMED,

  // special
  ...ladder('special', 'lvl', (s) => levelOf(s.xp).level, [
    [5, '🥉', 'Пятый уровень', 'Достичь 5 уровня', 'common'],
    [10, '🥈', 'Десятый уровень', 'Достичь 10 уровня', 'rare'],
    [20, '🥇', 'Двадцатый уровень', 'Достичь 20 уровня', 'epic'],
    [30, '💠', 'Тридцатый уровень', 'Достичь 30 уровня', 'legendary'],
  ]),
  ...ladder('special', 'age', (s) => Math.floor((Date.now() - new Date(s.created_at).getTime()) / 86_400_000), [
    [30, '🌱', 'Месяц с нами', 'Аккаунту 30 дней', 'common'],
    [180, '🌳', 'Полгода с нами', 'Аккаунту полгода', 'rare'],
    [365, '🎂', 'Старожил', 'Аккаунту год', 'epic'],
  ]),
  {
    id: 'series10',
    category: 'special',
    icon: '🗺️',
    label: 'Путешественник по мирам',
    hint: 'Получить 10 достижений за аниме',
    rarity: 'epic',
    goal: 10,
    value: (s) => ACHIEVEMENTS.filter((a) => a.category === 'series' && a.value(s) >= a.goal).length,
  },
]

export const achievementById = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)

export interface Progress {
  a: Achievement
  value: number
  done: boolean
}
export function evaluate(s: Stats): Progress[] {
  return ACHIEVEMENTS.map((a) => {
    const value = a.value(s)
    return { a, value, done: value >= a.goal }
  })
}

/** the achievement that opens a theme, if any */
export const achievementForTheme = (theme: string) => ACHIEVEMENTS.find((a) => a.reward?.theme === theme)
