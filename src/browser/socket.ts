import { KAPI_SERVER_PORT } from '../constants.js'

let socket: WebSocket | null = null
let onCommentsDone: (() => void) | null = null
let onCommentsProcessing: ((status: string) => void) | null = null

export function connectSocket(): WebSocket {
  socket = new WebSocket(`ws://localhost:${KAPI_SERVER_PORT}`)

  socket.addEventListener('open', () => console.log('[kapi] connected to kapi server'))
  socket.addEventListener('close', () => console.log('[kapi] disconnected from kapi server'))
  socket.addEventListener('error', (e) => console.error('[kapi] websocket error', e))
  socket.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'comments:done') onCommentsDone?.()
      if (msg.type === 'comments:processing') onCommentsProcessing?.(msg.status)
    } catch {
      /* ignore malformed messages */
    }
  })

  return socket
}

export function sendComments(prompt: string) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error('[kapi] cannot send comments: socket not connected')
    return
  }
  socket.send(JSON.stringify({ type: 'comments:submit', prompt }))
}

export function setOnCommentsDone(callback: () => void) {
  onCommentsDone = callback
}

export function setOnCommentsProcessing(callback: (status: string) => void) {
  onCommentsProcessing = callback
}
