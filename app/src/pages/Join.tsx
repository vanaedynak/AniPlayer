// #/join/CODE: an invite opened in the browser version — joins the room, which then leads to its episode
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, Users } from 'lucide-react'
import { joinRoom } from '../lib/room'
import { useSync } from '../lib/sync'
import { needAccount } from '../lib/guest'
import { Empty } from '../components/ui'

export default function Join() {
  const { code = '' } = useParams()
  const user = useSync((s) => s.user)
  const ready = useSync((s) => s.ready)
  const nav = useNavigate()
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!ready) return
    if (!user) {
      needAccount('Смотреть вместе с друзьями')
      return
    }
    joinRoom(code)
      .then((room) => nav(room.path, { replace: true }))
      .catch((e: Error) => setErr(e.message))
  }, [code, user, ready, nav])
  if (err) return <Empty icon={<Users />} title="Не удалось войти в комнату" text={err} />
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      {user ? <Loader2 className="animate-spin text-accent-2" size={36} /> : <Users className="text-accent-2" size={36} />}
      <div className="text-xl font-extrabold">{user ? 'Входим в комнату друга…' : 'Войдите, чтобы смотреть вместе'}</div>
      <div className="font-mono text-2xl font-extrabold tracking-[0.3em] text-muted">{code.toUpperCase()}</div>
    </div>
  )
}
