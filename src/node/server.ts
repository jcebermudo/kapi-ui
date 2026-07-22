import http from 'http'
import { spawn, type ChildProcess } from 'child_process'
import { WebSocketServer, WebSocket } from 'ws'
import type { KapiAgent, KapiServerOptions, AgentSession, AgentProvider } from './types.js'

let session: AgentSession | null = null // codex only — claude tracks its own session id below
let portPromise: Promise<number> | null = null
let serverStarted = false
const processBySocket = new WeakMap<WebSocket, ChildProcess>() // codex only

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function describeClaudeToolUse(name: string, input: any): string {
  switch (name) {
    case 'Read':
      return `Reading ${input?.file_path ?? 'a file'}`
    case 'Edit':
    case 'Write':
      return `Editing ${input?.file_path ?? 'a file'}`
    case 'Bash':
      return `Running: ${String(input?.command ?? '').slice(0, 60)}`
    case 'Grep':
      return `Searching for "${input?.pattern ?? ''}"`
    case 'Glob':
      return `Finding files matching ${input?.pattern ?? ''}`
    default:
      return `Using ${name}`
  }
}

// Event-parsing helpers for the persistent Claude process below. Not an
// AgentProvider — Claude doesn't spawn per submission, so it has no
// startSession/resumeSession.
const claudeEvents = {
  sessionIdFromEvent(event: any): string | null {
    return typeof event?.session_id === 'string' ? event.session_id : null
  },
  describeEvent(event: any): string | null {
    if (event?.type !== 'assistant' || !event.message?.content) return null
    for (const block of event.message.content) {
      if (block.type === 'tool_use') return describeClaudeToolUse(block.name, block.input)
      if (block.type === 'text' && block.text) return block.text.slice(0, 120)
      // Thinking content isn't exposed by the API (comes back redacted/empty),
      // but the block itself still arrives — surface it so "Starting..."
      // doesn't sit frozen for the several seconds Claude spends reasoning
      // before its first visible tool call.
      if (block.type === 'thinking') return 'Thinking...'
    }
    return null
  },
}

const codexProvider: AgentProvider = {
  startSession(cwd, prompt) {
    return spawn('codex', ['exec', '--json', '--sandbox', 'workspace-write', '--cd', cwd, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  },
  resumeSession(activeSession, prompt) {
    return spawn('codex', ['exec', 'resume', activeSession.id, '--json', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  },
  sessionIdFromEvent(event: any) {
    return typeof event?.thread_id === 'string' ? event.thread_id : null
  },
  describeEvent(event: any) {
    const item = event?.item
    if (item?.type === 'command_execution' && item.command) return `Running: ${String(item.command).slice(0, 60)}`
    if (item?.type === 'agent_message' && item.text) return String(item.text).slice(0, 120)
    if (item?.type === 'file_change' && item.path) return `Editing ${item.path}`
    return null
  },
}

function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const server = http.createServer()

      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[kapi] Port ${port} in use, trying ${port + 1}`)
          tryPort(port + 1)
        } else {
          reject(err)
        }
      })

      server.once('listening', () => {
        server.close()
        resolve(port)
      })

      server.listen(port, 'localhost')
    }

    tryPort(startPort)
  })
}

// --- Persistent Claude process ---------------------------------------------
// One warm `claude -p --input-format stream-json` process serves every
// submission, across every tab (they share one session anyway — see
// kapi/CLAUDE.md's Session Management section). This avoids CLI cold-start
// and --resume-from-disk overhead on each comment: the process, its
// tool-use context, and the prompt cache all stay warm between submissions.

const KAPI_SESSION_PROMPT =
  "You're applying UI edits from visual comments. Each comment gives the exact file:line:col — go straight there, don't search for it. Make only the requested edit. Stay terse: no narration between tool calls, and finish with at most one short sentence."

let sessionId: string | null = null
let claudeProc: ChildProcess | null = null
// Which socket's turn is currently running on the persistent process.
let activeSocket: WebSocket | null = null
// FIFO queue of submissions waiting for the persistent process to free up.
const pendingPrompts: Array<{ prompt: string; socket: WebSocket }> = []

function ensureClaudeProc(): ChildProcess | null {
  if (claudeProc && claudeProc.exitCode === null) return claudeProc

  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    'Read,Edit,Write',
    '--append-system-prompt',
    KAPI_SESSION_PROMPT,
  ]
  if (sessionId) args.push('--resume', sessionId)

  let claude: ChildProcess
  try {
    claude = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (err) {
    console.error('[kapi] failed to spawn claude:', err)
    return null
  }
  claudeProc = claude

  let buffer = ''
  claude.stdout!.on('data', (chunk) => {
    buffer += chunk.toString()
    let newlineIndex: number
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue

      let event: any
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }

      const nextSessionId = claudeEvents.sessionIdFromEvent(event)
      if (nextSessionId && nextSessionId !== sessionId) {
        sessionId = nextSessionId
        console.log(`[kapi] claude session started: ${sessionId}`)
      }

      if (event.type === 'result') {
        // Turn finished — notify the submitter and start the next queued batch.
        finishActiveTurn()
        continue
      }

      const status = claudeEvents.describeEvent(event)
      if (status && activeSocket) send(activeSocket, { type: 'comments:processing', status })
    }
  })
  claude.stderr!.pipe(process.stderr)

  claude.on('error', (err) => {
    console.error('[kapi] claude process error:', err)
  })
  // Writes to stdin can outrace process teardown (e.g. right after a kill()
  // from stopComments); without this listener that throws an uncaught EPIPE.
  claude.stdin!.on('error', (err) => {
    console.error('[kapi] claude stdin error:', err)
  })
  claude.on('close', () => {
    if (claudeProc === claude) claudeProc = null
    // A queued batch (or the killed-and-stopped one's successor) respawns
    // the process, resuming the same session via --resume.
    finishActiveTurn()
  })

  console.log(`[kapi] claude process started${sessionId ? ` (resuming ${sessionId})` : ''}`)
  return claude
}

function finishActiveTurn() {
  if (activeSocket) {
    send(activeSocket, { type: 'comments:done' })
    activeSocket = null
  }
  processQueue()
}

function processQueue() {
  if (activeSocket || pendingPrompts.length === 0) return

  const claude = ensureClaudeProc()
  if (!claude || !claude.stdin) {
    console.error('[kapi] cannot process comments: claude process unavailable')
    // Nothing will retry this later, so drain the whole backlog now rather
    // than stranding everything behind the first failed prompt.
    const stranded = pendingPrompts.splice(0, pendingPrompts.length)
    for (const { socket } of stranded) send(socket, { type: 'comments:done' })
    return
  }

  const next = pendingPrompts.shift()!
  activeSocket = next.socket
  send(next.socket, { type: 'comments:processing', status: 'Starting...' })
  try {
    claude.stdin.write(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: next.prompt }] },
      }) + '\n',
    )
  } catch (err) {
    console.error('[kapi] failed to write prompt to claude stdin:', err)
    finishActiveTurn()
  }
}

function processClaudeComments(prompt: string, socket: WebSocket) {
  pendingPrompts.push({ prompt, socket })
  processQueue()
}

function stopComments(socket: WebSocket) {
  // Drop anything this socket queued but hasn't started.
  for (let i = pendingPrompts.length - 1; i >= 0; i--) {
    if (pendingPrompts[i]!.socket === socket) pendingPrompts.splice(i, 1)
  }
  if (activeSocket === socket && claudeProc) {
    console.log('[kapi] stopping claude process')
    claudeProc.kill()
    // close handler sends comments:done, clears activeSocket, and the next
    // submission respawns with --resume so the session continues.
  }
}
// -----------------------------------------------------------------------------

async function processCodexComments(prompt: string, socket: WebSocket, cwd: string) {
  const isNewSession = session?.agent !== 'codex'
  send(socket, { type: 'comments:processing', status: isNewSession ? 'Starting Codex...' : 'Continuing session...' })

  const child = isNewSession ? codexProvider.startSession(cwd, prompt) : codexProvider.resumeSession(session!, prompt)
  processBySocket.set(socket, child)

  let buffer = ''
  let failed = false
  const handleEvent = (event: unknown) => {
    const nextSessionId = codexProvider.sessionIdFromEvent(event)
    if (nextSessionId) {
      session = { agent: 'codex', id: nextSessionId }
      console.log(`[kapi] codex session started: ${nextSessionId}`)
    }
    const status = codexProvider.describeEvent(event)
    if (status) send(socket, { type: 'comments:processing', status })
  }

  child.stdout!.on('data', (chunk) => {
    buffer += chunk.toString()
    let newlineIndex: number
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue

      try {
        handleEvent(JSON.parse(line))
      } catch {
        // Ignore non-JSON progress from a CLI and continue reading its stream.
      }
    }
  })
  child.stderr!.pipe(process.stderr)
  child.on('error', (error) => {
    failed = true
    send(socket, { type: 'comments:error', message: error.message })
  })
  child.on('close', (code) => {
    if (buffer.trim()) {
      try {
        handleEvent(JSON.parse(buffer))
      } catch {
        // A final non-JSON line is only CLI output, not a Kapi protocol event.
      }
    }
    processBySocket.delete(socket)
    if (code !== 0 && !child.killed && !failed) {
      send(socket, { type: 'comments:error', message: `codex exited with code ${code}.` })
    } else if (!failed) {
      send(socket, { type: 'comments:done' })
    }
  })
}

export function startServer(portNumber: number, options: KapiServerOptions = {}): Promise<number> {
  if (serverStarted) return portPromise!
  serverStarted = true

  const agent: KapiAgent = options.agent ?? 'claude'
  const cwd = process.cwd()
  portPromise = (async () => {
    const actualPort = await findAvailablePort(portNumber)
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('I love capybaras')
    })

    server.listen(actualPort, 'localhost', () => {
      console.log(`[kapi] Server running at http://localhost:${actualPort} (${agent})`)
    })

    const wss = new WebSocketServer({ server })
    wss.on('connection', (socket) => {
      console.log('[kapi] overlay connected via websocket')
      socket.on('close', () => {
        console.log('[kapi] overlay disconnected')
        // Drop this socket's queued prompts and stop its in-flight turn (if
        // any) so a closed tab doesn't leave orphaned work or a stuck queue.
        if (agent === 'claude') stopComments(socket)
      })
      socket.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString())
          if (message.type === 'comments:submit') {
            if (agent === 'claude') processClaudeComments(message.prompt, socket)
            else void processCodexComments(message.prompt, socket, cwd)
          }
          if (message.type === 'comments:stop') {
            if (agent === 'claude') {
              stopComments(socket)
            } else {
              const child = processBySocket.get(socket)
              if (child) {
                console.log('[kapi] stopping codex process')
                child.kill()
                processBySocket.delete(socket)
              }
            }
          }
        } catch {
          /* ignore malformed messages */
        }
      })
    })

    // Warm the Claude process at startup so the first comment is fast too.
    if (agent === 'claude') ensureClaudeProc()

    return actualPort
  })()

  return portPromise
}
