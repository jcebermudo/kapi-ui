// Talks to the dev server over Vite's built-in HMR websocket (custom events)
// rather than a dedicated kapi server on its own port. `import.meta.hot` is
// injected by Vite into the modules it serves in dev, so the overlay already
// has a live channel to the dev server — no port discovery, no second socket.
let onCommentsDone: (() => void) | null = null
let onCommentsProcessing: ((status: string) => void) | null = null
let onCommentsError: ((message: string) => void) | null = null

export function connectSocket() {
  const hot = import.meta.hot
  if (!hot) {
    console.error('[kapi] no HMR channel — is the dev server running with the kapi plugin?')
    return
  }
  hot.on('kapi:done', () => onCommentsDone?.())
  hot.on('kapi:processing', (data: { status: string }) => onCommentsProcessing?.(data.status))
  hot.on('kapi:error', (data: { message: string }) => onCommentsError?.(data.message))
}

export function sendComments(prompt: string) {
  const hot = import.meta.hot
  if (!hot) return console.error('[kapi] cannot send comments: no HMR channel')
  hot.send('kapi:submit', { prompt })
}

export function stopComments() {
  const hot = import.meta.hot
  if (!hot) return console.error('[kapi] cannot stop comments: no HMR channel')
  hot.send('kapi:stop', {})
}

export function setOnCommentsDone(callback: () => void) {
  onCommentsDone = callback
}

export function setOnCommentsProcessing(callback: (status: string) => void) {
  onCommentsProcessing = callback
}

export function setOnCommentsError(callback: (message: string) => void) {
  onCommentsError = callback
}
