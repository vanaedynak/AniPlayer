// Discord Rich Presence over Discord's local pipe (no extra package): «Смотрит Anyflow · Магическая битва ·
// Серия 8», with a «Смотреть вместе» button that opens the watch-together room for whoever clicks it.
// Discord desktop listens on \\?\pipe\discord-ipc-0…9; each message is [opcode][length][JSON], little-endian.
const net = require('node:net')

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 }

let sock = null
let ready = false
let clientId = ''
let activity = null
let retry = null
let buf = Buffer.alloc(0)

function send(op, data) {
  if (!sock) return
  const json = Buffer.from(JSON.stringify(data), 'utf8')
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(json.length, 4)
  sock.write(Buffer.concat([head, json]))
}

function push() {
  if (!ready) return
  send(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity ?? undefined }, nonce: String(Date.now()) + Math.random() })
}

function drop() {
  ready = false
  if (sock) {
    sock.removeAllListeners()
    sock.destroy()
  }
  sock = null
}

function schedule() {
  clearTimeout(retry)
  // Discord may start after the app, or restart: try again now and then while there is something to show
  if (activity && clientId) retry = setTimeout(connect, 20_000)
}

function connect(n = 0) {
  if (sock || !clientId) return
  if (n > 9) return schedule()
  const s = net.createConnection(`\\\\?\\pipe\\discord-ipc-${n}`)
  s.once('error', () => {
    s.destroy()
    if (sock === s) sock = null
    connect(n + 1)
  })
  s.once('connect', () => {
    sock = s
    s.removeAllListeners('error')
    s.on('error', () => {})
    s.on('close', () => {
      drop()
      schedule()
    })
    s.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0)
        const len = buf.readInt32LE(4)
        if (buf.length < 8 + len) break
        let msg = null
        try {
          msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8'))
        } catch {}
        buf = buf.subarray(8 + len)
        if (op === OP.PING) send(OP.PONG, msg)
        else if (op === OP.CLOSE) drop()
        else if (msg?.evt === 'READY') {
          ready = true
          push()
        }
      }
    })
    send(OP.HANDSHAKE, { v: 1, client_id: clientId })
  })
}

/** shows `act` (or clears the status with null) under the Discord application `id` */
function setActivity(id, act) {
  activity = act
  if (id !== clientId) {
    drop()
    clientId = id || ''
  }
  if (!clientId) return
  if (ready) push()
  else if (activity) connect()
}

function shutdown() {
  clearTimeout(retry)
  activity = null
  if (ready) push()
  drop()
}

module.exports = { setActivity, shutdown }
