// Kodik's embeddable player speaks a postMessage API: we use it to seek and to read playback time.
export function kodikCommand(frame: HTMLIFrameElement | null, method: string, extra: Record<string, unknown> = {}) {
  frame?.contentWindow?.postMessage({ key: 'kodik_player_api', value: { method, ...extra } }, '*')
}
