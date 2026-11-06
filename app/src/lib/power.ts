// Power saving for long reading on battery: switched on by the person, it works only while a reader is
// open. Animations, page curls, paper and room sounds, blur and texture layers stop, and background work
// (downloads, update checks) waits until the reader is closed.
import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { hideStatusBarWhileReading } from './platform'

export const usePower = create<{ save: boolean; setSave: (save: boolean) => void }>()(
  persist((set) => ({ save: false, setSave: (save) => set({ save }) }), { name: 'anyflow-power-save' }),
)

let readers = 0
const listeners = new Set<(on: boolean) => void>()
let was = false

/** true while power saving is on and a reader is open */
export const powerSaving = () => usePower.getState().save && readers > 0

function sync() {
  const on = powerSaving()
  document.documentElement.classList.toggle('power-save', on)
  if (on !== was) {
    was = on
    listeners.forEach((l) => l(on))
  }
}
usePower.subscribe(sync)

/** called when power saving starts or stops applying */
export function onPowerSaving(cb: (on: boolean) => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

/** a reader is open: the iPad status bar hides and power saving (if on) applies until it closes */
export function useReaderSession() {
  useEffect(() => {
    readers++
    sync()
    const showBar = hideStatusBarWhileReading()
    return () => {
      readers = Math.max(0, readers - 1)
      sync()
      showBar()
    }
  }, [])
}

/** for the readers: is power saving on right now */
export const usePowerSave = () => usePower((s) => s.save)
