// Guests watch and read, but nothing is kept for them: history, lists, shelf and stats need an account.
// The stores ask here before saving; sync tells this module who is signed in. No imports, so no cycles.
import { create } from 'zustand'

let signed = false
export const setSignedIn = (v: boolean) => {
  signed = v
  if (v) useGuest.setState({ ask: null })
}
export const isSignedIn = () => signed

/** ask: why the "sign up" card is open (null: closed) */
export const useGuest = create<{ ask: string | null }>(() => ({ ask: null }))

/** true for an account; for a guest it opens the sign-up card with the reason and returns false */
export function needAccount(reason: string) {
  if (signed) return true
  useGuest.setState({ ask: reason })
  return false
}
