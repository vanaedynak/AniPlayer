import { useState } from 'react'
import { FolderOpen, FolderCheck, TriangleAlert } from 'lucide-react'
import { folderSupported, useFolder } from '../lib/offline'
import { chooseFolder } from '../lib/library'
import { Panel } from './ui'

/** iPad: where downloads are kept. Without a picked folder they live inside the app and go with it. */
export function FolderPanel() {
  const { name, lost } = useFolder()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  if (!folderSupported) return null

  const pick = async () => {
    setBusy(true)
    setNote('')
    try {
      const r = await chooseFolder()
      if (r) setNote(r.moved ? `Перенесено в папку: ${r.moved}${r.left ? `, не удалось перенести: ${r.left}` : ''}` : 'Готово: новое скачанное будет сохраняться сюда')
    } catch (e) {
      setNote(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel className="!p-4 sm:!p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className={name ? 'text-emerald-300' : lost ? 'text-yellow-300' : 'text-muted'}>{name ? <FolderCheck size={28} /> : lost != null ? <TriangleAlert size={28} /> : <FolderOpen size={28} />}</div>
        <div className="min-w-0 flex-1">
          <div className="font-extrabold">{name ? `Папка для загрузок: ${name}` : lost != null ? `Папка${lost ? ` «${lost}»` : ''} больше недоступна` : 'Скачанное хранится внутри приложения'}</div>
          <div className="text-sm font-semibold text-muted">
            {name
              ? 'Серии, главы и книги сохраняются сюда и останутся, даже если удалить приложение. После переустановки выберите эту же папку, и всё скачанное вернётся.'
              : lost != null
                ? 'Так бывает после переустановки. Выберите ту же папку снова, и приложение найдёт в ней всё скачанное.'
                : 'Если удалить приложение, всё скачанное пропадёт. Выберите папку в «Файлы»: «На iPad» (создайте там, например, «Anyflow») или iCloud Drive.'}
          </div>
          {note && <div className="mt-1 text-sm font-bold text-accent-2">{note}</div>}
        </div>
        <button onClick={pick} disabled={busy} className="flex h-11 items-center gap-2 rounded-full bg-white px-5 font-bold text-black disabled:opacity-50">
          <FolderOpen size={16} /> {busy ? 'Переношу…' : name ? 'Сменить папку' : 'Выбрать папку'}
        </button>
      </div>
    </Panel>
  )
}
