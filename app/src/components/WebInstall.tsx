// The site in a browser: a one-time card offering to put Anyflow on the home screen, where it opens full
// screen without the browser's bars, like the app. Chrome and Edge install it with one button; Safari on
// iPad and iPhone needs «Поделиться → На экран „Домой“».
import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { isIOS, isStandalone, isWeb } from '../lib/platform'

const KEY = 'aniplayer-install-hint'
type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export function WebInstall() {
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [shown, setShown] = useState(() => {
    try {
      return isWeb && !isStandalone && !localStorage.getItem(KEY)
    } catch {
      return false
    }
  })
  useEffect(() => {
    const on = (e: Event) => {
      e.preventDefault()
      setPrompt(e as Prompt)
    }
    window.addEventListener('beforeinstallprompt', on)
    return () => window.removeEventListener('beforeinstallprompt', on)
  }, [])
  const close = () => {
    setShown(false)
    try {
      localStorage.setItem(KEY, String(Date.now()))
    } catch {
      /* shown again next time */
    }
  }
  // nothing to offer: a desktop browser without the install prompt
  if (!shown || (!isIOS && !prompt)) return null
  return (
    <div className="animate-fade-up fixed inset-x-3 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-3xl bg-card/95 p-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl lg:right-6 lg:left-auto" style={{ bottom: 'calc(max(var(--safe-bottom), 8px) + 72px)' }}>
      <img src="apple-touch-icon.png" alt="" className="h-12 w-12 shrink-0 rounded-2xl" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-extrabold">Anyflow как приложение</div>
        {prompt ? (
          <div className="text-muted">На весь экран, со своим значком — без скачиваний</div>
        ) : (
          <div className="text-muted">
            Нажмите <Share size={14} className="inline -translate-y-0.5" /> «Поделиться», затем <SquarePlus size={14} className="inline -translate-y-0.5" /> «На экран „Домой“»
          </div>
        )}
      </div>
      {prompt && (
        <button
          onClick={() => {
            void prompt.prompt()
            void prompt.userChoice.finally(close)
          }}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-extrabold text-black"
        >
          <Download size={15} /> Установить
        </button>
      )}
      <button onClick={close} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/10" aria-label="Закрыть">
        <X size={17} />
      </button>
    </div>
  )
}
