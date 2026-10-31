export function fmtTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = h ? String(m).padStart(2, '0') : String(m).padStart(2, '0')
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0')
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  if (b === 1) return one
  return many
}

export const episodesWord = (n: number) => plural(n, 'серия', 'серии', 'серий')

export function relTime(ts: number) {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return 'только что'
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  const days = Math.floor(diff / 86400)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`
  const d = new Date(ts)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

export function fmtOrdinal(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')
