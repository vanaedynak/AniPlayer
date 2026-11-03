// MangaDex pictures (covers and pages) on the iPad and Android. MangaDex now puts its bot check in front
// of its pictures too: a request that looks like a browser gets "Bot challenge not passed" (HTTP 403).
// The app answers it the way it answers the API, by naming itself honestly, but an <img> in the
// web view can't set a header, so these pictures come through the native layer and are shown from
// memory. The PC app sets the header for every MangaDex request itself (electron/main.cjs).
import { useEffect, useState } from 'react'
import { CapacitorHttp } from '@capacitor/core'
import { isNative } from '../lib/platform'
import { CLIENT } from './md'

const MD = /^https:\/\/([a-z0-9-]+\.)*(mangadex\.org|mangadex\.network)\//i

/** a picture that has to come through the native layer */
export const viaNative = (url: string) => isNative && MD.test(url)

/** a MangaDex picture's bytes, asked for under the app's own name */
export async function mdBytes(url: string): Promise<Uint8Array> {
  const r = await CapacitorHttp.get({ url, responseType: 'arraybuffer', headers: { 'User-Agent': CLIENT } })
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`)
  // binary bodies come over from the native side as base64
  const b64 = typeof r.data === 'string' ? r.data : ''
  return new Uint8Array(await (await fetch(`data:application/octet-stream;base64,${b64}`)).arrayBuffer())
}

// pictures already fetched, newest last; the oldest are let go so pages of long reads don't pile up
const loaded = new Map<string, Promise<string>>()
const KEEP = 80

function local(url: string) {
  let p = loaded.get(url)
  if (p) {
    loaded.delete(url)
    loaded.set(url, p)
    return p
  }
  p = mdBytes(url).then((b) => URL.createObjectURL(new Blob([b as BlobPart])))
  loaded.set(url, p)
  p.catch(() => loaded.delete(url))
  if (loaded.size > KEEP) {
    const [old, op] = loaded.entries().next().value!
    loaded.delete(old)
    void op.then(URL.revokeObjectURL).catch(() => {})
  }
  return p
}

/**
 * The address to put in an <img>: the picture itself, or on the iPad and Android a MangaDex picture
 * fetched under the app's name (undefined until it arrives, '' when it couldn't be had).
 */
export function useImgSrc(url: string): string | undefined {
  const native = viaNative(url)
  const [src, setSrc] = useState<{ url: string; src: string } | null>(null)
  useEffect(() => {
    if (!native) return
    let alive = true
    local(url)
      .then((s) => alive && setSrc({ url, src: s }))
      .catch(() => alive && setSrc({ url, src: '' }))
    return () => {
      alive = false
    }
  }, [url, native])
  if (!native) return url
  return src?.url === url ? src.src : undefined
}
