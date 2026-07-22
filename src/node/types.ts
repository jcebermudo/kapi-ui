// Shared type definitions for the node tier (dev server, vite plugin, nuxt
// module). `KapiOptions` and `KapiAgent` are re-exported by vite-plugin.ts as
// part of the package's public API.
import type { ChildProcess } from 'child_process'

export type KapiAgent = 'claude' | 'codex'

export interface KapiServerOptions {
  agent?: KapiAgent
}

export interface AgentSession {
  agent: KapiAgent
  id: string
}

// Shape for agents that spawn a fresh CLI process per submission, resuming
// via a session id (currently Codex). Claude instead keeps one warm,
// stdin-driven process across submissions — see ensureClaudeProc() in
// server.ts — so it doesn't implement this interface.
export interface AgentProvider {
  startSession(cwd: string, prompt: string): ChildProcess
  resumeSession(session: AgentSession, prompt: string): ChildProcess
  sessionIdFromEvent(event: unknown): string | null
  describeEvent(event: unknown): string | null
}

export interface KapiOptions {
  /** CLI agent used to process comments. Defaults to Claude Code. */
  agent?: KapiAgent
}
