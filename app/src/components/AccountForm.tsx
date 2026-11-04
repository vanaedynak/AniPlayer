import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { signIn, useSync } from '../lib/sync'
import { cn } from '../lib/format'

/** what went wrong with a sign-in or sign-up, in words */
function authErrorText(code: string) {
  return code.includes('invalid-credential') || code.includes('wrong-password')
    ? 'Неверный логин или пароль'
    : code.includes('too-many')
      ? 'Слишком много регистраций, попробуйте через минуту'
      : code.includes('email-already-in-use') || code.includes('username-taken')
        ? 'Такой аккаунт уже есть — нажмите «Войти» (или выберите другое имя)'
        : code.includes('bad-username')
          ? 'Имя: 3–24 символа, латиница, цифры, точка, «-» или «_»'
          : code.includes('invalid-email')
            ? 'Проверьте почту'
            : code.includes('weak-password')
              ? 'Пароль минимум 6 символов'
              : code
}

const input = 'w-full rounded-2xl bg-white/[0.06] px-4 py-3 font-semibold outline-none ring-1 ring-white/10 placeholder:text-muted focus:ring-accent'

/** sign in or create an account: the start screen and the "this needs an account" card */
export function AccountForm({ initial = 'in' }: { initial?: 'in' | 'up' }) {
  const moving = useSync((s) => s.moving)
  const [mode, setMode] = useState(initial)
  const [login, setLogin] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const up = mode === 'up'

  const go = async () => {
    if (up && pass !== pass2) return setMsg('Пароли не совпадают')
    setBusy(true)
    setMsg('')
    try {
      await signIn(login.trim(), pass, up)
    } catch (e) {
      setMsg(authErrorText((e as { code?: string }).code ?? String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void go()
      }}
    >
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white/[0.05] p-1">
        {(['in', 'up'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => (setMode(m), setMsg(''))}
            className={cn('rounded-xl py-2 text-sm font-bold transition', mode === m ? 'bg-accent text-white' : 'text-muted hover:text-white')}
          >
            {m === 'in' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        ))}
      </div>
      <input
        className={input}
        placeholder={up ? 'Имя пользователя (или почта)' : 'Имя пользователя или почта'}
        value={login}
        onChange={(e) => setLogin(e.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <input
        className={input}
        type="password"
        placeholder="Пароль"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        autoComplete={up ? 'new-password' : 'current-password'}
      />
      {up && <input className={input} type="password" placeholder="Пароль ещё раз" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />}
      <button
        type="submit"
        disabled={busy || !login.trim() || !pass}
        className="rounded-2xl bg-white py-3 font-extrabold text-black transition hover:bg-white/90 disabled:opacity-50"
      >
        {moving ? 'Переносим данные…' : busy ? <Loader2 className="mx-auto animate-spin" /> : up ? 'Создать аккаунт' : 'Войти'}
      </button>
      {up && <p className="text-xs text-muted">Письма не нужны: аккаунт работает сразу. Тот же логин подходит для ПК, iPad и Android.</p>}
      {msg && <div className="text-sm font-semibold text-rose-400">{msg}</div>}
    </form>
  )
}
