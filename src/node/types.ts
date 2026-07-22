// Shared type definitions for the node tier (dev server, vite plugin, nuxt
// module). `KapiOptions` and `KapiAgent` are re-exported by vite-plugin.ts as
// part of the package's public API.
import type { WebSocket } from 'ws'

export type KapiAgent = 'claude' | 'codex'

export interface KapiServerOptions {
  agent?: KapiAgent
}

export interface AgentSession {
  agent: KapiAgent
  id: string
}

// Common shape server.ts dispatches through, regardless of which agent is
// configured. claude-agent.ts and codex-agent.ts each implement this — their
// internals differ a lot (one warm stdin-driven process vs. one spawn per
// submission) but that difference stays inside each module; server.ts's
// dispatch code is identical for both.
export interface AgentRuntime {
  /** Called once when the dev server starts, before any tab connects. */
  start(cwd: string): void
  /** Handle a submitted comment batch from a tab. */
  submit(prompt: string, socket: WebSocket, cwd: string): void
  /** Cancel this socket's queued and in-flight work. */
  stop(socket: WebSocket): void
  /** Clean up this socket's queued and in-flight work when its tab disconnects. */
  onClose(socket: WebSocket): void
}

export interface KapiOptions {
  /** CLI agent used to process comments. Defaults to Claude Code. */
  agent?: KapiAgent
}
