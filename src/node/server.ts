import http from 'http'
import { spawn, type ChildProcess } from 'child_process'
import { WebSocketServer, WebSocket } from 'ws'

export type KapiAgent = 'claude' | 'codex'

export interface KapiServerOptions {
  agent?: KapiAgent
}

interface AgentSession {
  agent: KapiAgent
  id: string
}

interface AgentProvider {
  startSession(cwd: string, prompt: string): ChildProcess
  resumeSession(session: AgentSession, prompt: string): ChildProcess
  sessionIdFromEvent(event: unknown): string | null
  describeEvent(event: unknown): string | null
}

let session: AgentSession | null = null
let portPromise: Promise<number> | null = null
let serverStarted = false
const processBySocket = new WeakMap<WebSocket, ChildProcess>()

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

const claudeProvider: AgentProvider = {
  startSession(cwd, prompt) {
    return spawn('claude', ['-p', prompt, '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  },
  resumeSession(activeSession, prompt) {
    return spawn(
      'claude',
      ['-p', '--resume', activeSession.id, '--permission-mode', 'acceptEdits', prompt, '--output-format', 'stream-json', '--verbose'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
  },
  sessionIdFromEvent(event: any) {
    return typeof event?.session_id === 'string' ? event.session_id : null
  },
  describeEvent(event: any) {
    if (event?.type !== 'assistant' || !event.message?.content) return null
    for (const block of event.message.content) {
      if (block.type === 'tool_use') return describeClaudeToolUse(block.name, block.input)
      if (block.type === 'text' && block.text) return block.text.slice(0, 120)
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

const providers: Record<KapiAgent, AgentProvider> = {
  claude: claudeProvider,
  codex: codexProvider,
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

async function processComments(prompt: string, socket: WebSocket, agent: KapiAgent, cwd: string) {
  const provider = providers[agent]
  const isNewSession = session?.agent !== agent
  send(socket, { type: 'comments:processing', status: isNewSession ? `Starting ${agent === 'claude' ? 'Claude Code' : 'Codex'}...` : 'Continuing session...' })

  const child = isNewSession ? provider.startSession(cwd, prompt) : provider.resumeSession(session!, prompt)
  processBySocket.set(socket, child)

  let buffer = ''
  let failed = false
  const handleEvent = (event: unknown) => {
    const nextSessionId = provider.sessionIdFromEvent(event)
    if (nextSessionId) {
      session = { agent, id: nextSessionId }
      console.log(`[kapi] ${agent} session started: ${nextSessionId}`)
    }
    const status = provider.describeEvent(event)
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
      send(socket, { type: 'comments:error', message: `${agent} exited with code ${code}.` })
    } else if (!failed) {
      send(socket, { type: 'comments:done' })
    }
  })
}

export function startServer(portNumber: number, options: KapiServerOptions = {}): Promise<number> {
  if (serverStarted) return portPromise!
  serverStarted = true

  const agent = options.agent ?? 'claude'
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
      socket.on('close', () => console.log('[kapi] overlay disconnected'))
      socket.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString())
          if (message.type === 'comments:submit') void processComments(message.prompt, socket, agent, cwd)
          if (message.type === 'comments:stop') {
            const child = processBySocket.get(socket)
            if (child) {
              console.log(`[kapi] stopping ${agent} process`)
              child.kill()
              processBySocket.delete(socket)
            }
          }
        } catch {
          /* ignore malformed messages */
        }
      })
    })

    return actualPort
  })()

  return portPromise
}
