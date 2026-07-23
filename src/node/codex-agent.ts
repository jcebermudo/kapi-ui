// Codex spawns a fresh `codex exec` process per submission, resuming
// continuity via a session id (--resume). Unlike Claude, it has no
// stdin-driven persistent mode, so there's no warm process to keep alive.
import { spawn, type ChildProcess } from 'child_process'
import type { AgentRuntime, AgentClient, AgentSession } from './types.js'

function startSession(cwd: string, prompt: string): ChildProcess {
  return spawn('codex', ['exec', '--json', '--sandbox', 'workspace-write', '--cd', cwd, prompt], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function resumeSession(activeSession: AgentSession, prompt: string): ChildProcess {
  return spawn('codex', ['exec', 'resume', activeSession.id, '--json', prompt], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function sessionIdFromEvent(event: any): string | null {
  return typeof event?.thread_id === 'string' ? event.thread_id : null
}

function describeEvent(event: any): string | null {
  const item = event?.item
  if (item?.type === 'command_execution' && item.command) return `Running: ${String(item.command).slice(0, 60)}`
  if (item?.type === 'agent_message' && item.text) return String(item.text).slice(0, 120)
  if (item?.type === 'file_change' && item.path) return `Editing ${item.path}`
  return null
}

let session: AgentSession | null = null
const processByClient = new WeakMap<AgentClient, ChildProcess>()

async function submitPrompt(prompt: string, client: AgentClient, cwd: string) {
  const isNewSession = session === null
  client.send('kapi:processing', { status: isNewSession ? 'Starting Codex...' : 'Continuing session...' })

  const child = isNewSession ? startSession(cwd, prompt) : resumeSession(session!, prompt)
  processByClient.set(client, child)

  let buffer = ''
  let failed = false
  const handleEvent = (event: unknown) => {
    const nextSessionId = sessionIdFromEvent(event)
    if (nextSessionId) {
      session = { agent: 'codex', id: nextSessionId }
      console.log(`[kapi] codex session started: ${nextSessionId}`)
    }
    const status = describeEvent(event)
    if (status) client.send('kapi:processing', { status })
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
    client.send('kapi:error', { message: error.message })
  })
  child.on('close', (code) => {
    if (buffer.trim()) {
      try {
        handleEvent(JSON.parse(buffer))
      } catch {
        // A final non-JSON line is only CLI output, not a Kapi protocol event.
      }
    }
    processByClient.delete(client)
    if (code !== 0 && !child.killed && !failed) {
      client.send('kapi:error', { message: `codex exited with code ${code}.` })
    } else if (!failed) {
      client.send('kapi:done')
    }
  })
}

function stop(client: AgentClient) {
  const child = processByClient.get(client)
  if (child) {
    console.log('[kapi] stopping codex process')
    child.kill()
    processByClient.delete(client)
  }
}

export const codexAgent: AgentRuntime = {
  // No persistent process to warm — each submission spawns its own.
  start() {},

  submit(prompt, client, cwd) {
    void submitPrompt(prompt, client, cwd)
  },

  stop,

  onClose(client) {
    stop(client)
  },
}
