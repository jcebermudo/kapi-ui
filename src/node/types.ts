// Shared type definitions for the node tier (vite plugin, nuxt module,
// agents). `KapiOptions` and `KapiAgent` are re-exported by vite-plugin.ts as
// part of the package's public API.

export type KapiAgent = 'claude' | 'codex'

export interface AgentSession {
  agent: KapiAgent
  id: string
}

// One connected tab, as the agents see it. The vite plugin builds a stable
// instance per connection (see configureServer) from Vite's HMR client, so
// its object identity doubles as the map key for tracking which tab a turn
// belongs to, and `send` pushes a custom HMR event back to that one tab.
export interface AgentClient {
  send(event: string, data?: unknown): void
}

// Common shape the vite plugin dispatches through, regardless of which agent
// is configured. claude-agent.ts and codex-agent.ts each implement this —
// their internals differ a lot (one warm stdin-driven process vs. one spawn
// per submission) but that difference stays inside each module; the plugin's
// dispatch code is identical for both.
export interface AgentRuntime {
  /** Called once when the dev server starts, before any tab connects. */
  start(cwd: string): void
  /** Handle a submitted comment batch from a tab. */
  submit(prompt: string, client: AgentClient, cwd: string): void
  /** Cancel this client's queued and in-flight work. */
  stop(client: AgentClient): void
  /** Clean up this client's queued and in-flight work when its tab disconnects. */
  onClose(client: AgentClient): void
}

export interface KapiOptions {
  /** CLI agent used to process comments. Defaults to Claude Code. */
  agent?: KapiAgent
}
