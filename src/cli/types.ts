// Shared type definitions for the CLI tier (setup + utils).

export type Framework = 'vite' | 'nuxt'
export type CodingAgent = 'claude' | 'codex'
// What setup writes into the config: a coding agent, or `false` for the
// manual copy/paste-only workflow (no agent session).
export type AgentChoice = CodingAgent | false
