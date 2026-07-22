#!/usr/bin/env node
import { createInterface } from 'readline/promises'
import { stdin as input, stdout as output } from 'process'
import {
  installKapi,
  injectVitePlugin,
  injectNuxtModule,
  detectFramework,
  detectInstalledAgents,
  KAPI_PACKAGE_NAME,
} from './utils.js'
import type { CodingAgent, Framework } from './types.js'

const FRAMEWORK_SETUP: Record<
  Framework,
  { label: string; inject: (cwd: string, agent: CodingAgent) => Promise<void>; manualInstructions: (agent: CodingAgent) => string }
> = {
  nuxt: {
    label: 'Nuxt',
    inject: injectNuxtModule,
    manualInstructions: (agent) => `
Add this manually to your nuxt.config:

  export default defineNuxtConfig({
    modules: ['${KAPI_PACKAGE_NAME}/nuxt'],
    kapi: { agent: '${agent}' },
  })
`,
  },
  vite: {
    label: 'Vite + Vue',
    inject: injectVitePlugin,
    manualInstructions: (agent) => `
Add this manually to your vite.config:

  import kapi from '${KAPI_PACKAGE_NAME}/vite-plugin'

  export default defineConfig({
    plugins: [kapi({ agent: '${agent}' })],
  })
`,
  },
}

function parseFrameworkFlag(): Framework | null {
  const args = process.argv.slice(2)
  if (args.includes('--nuxt')) return 'nuxt'
  if (args.includes('--vite')) return 'vite'
  return null
}

function parseAgentFlag(): CodingAgent | null {
  const args = process.argv.slice(2)
  const inlineValue = args.find((arg) => arg.startsWith('--agent='))?.split('=')[1]
  if (inlineValue === 'claude' || inlineValue === 'codex') return inlineValue
  if (inlineValue) throw new Error(`Unknown agent "${inlineValue}". Use "claude" or "codex".`)

  const flagIndex = args.indexOf('--agent')
  const value = flagIndex === -1 ? undefined : args[flagIndex + 1]
  if (flagIndex === -1) return null
  if (value === 'claude' || value === 'codex') return value
  throw new Error('Missing or invalid --agent value. Use "claude" or "codex".')
}

async function chooseAgent(): Promise<CodingAgent> {
  const requestedAgent = parseAgentFlag()
  const installedAgents = detectInstalledAgents()

  if (requestedAgent) {
    if (!installedAgents.includes(requestedAgent)) {
      throw new Error(`${requestedAgent} CLI is not installed. Install it, or run setup without --agent.`)
    }
    return requestedAgent
  }

  if (installedAgents.length === 0) {
    throw new Error('Neither Claude Code nor Codex CLI is installed. Install one, then run setup again.')
  }

  if (installedAgents.length === 1) return installedAgents[0]!

  const rl = createInterface({ input, output })
  const answer = await rl.question('Which coding agent should Kapi use?\n  1. Claude Code\n  2. Codex\n\nChoose [1]: ')
  rl.close()
  return answer.trim() === '2' ? 'codex' : 'claude'
}

async function setup() {
  console.log(`
██   ██  █████  ██████  ██
██  ██  ██   ██ ██   ██ ██
█████   ███████ ██████  ██
██  ██  ██   ██ ██      ██
██   ██ ██   ██ ██      ██
  `);

  const cwd = process.cwd()
  const framework = parseFrameworkFlag() ?? detectFramework(cwd)

  if (!framework) {
    console.error(`Could not detect a Vue project in ${cwd}.`)
    console.error(`kapi-ui only supports Vue apps (Vite + Vue, or Nuxt).`)
    console.error(`If this is a Vue project, re-run with --vite or --nuxt to skip detection.`)
    process.exit(1)
  }

  let agent: CodingAgent
  try {
    agent = await chooseAgent()
  } catch (err) {
    console.error(`Unable to choose a coding agent: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const { label, inject, manualInstructions } = FRAMEWORK_SETUP[framework]
  console.log(`\n✨ Detected ${label}; using ${agent === 'claude' ? 'Claude Code' : 'Codex'} — setting up kapi...\n`)

  try {
    installKapi(cwd)
    await inject(cwd, agent)
    console.log('done!')
  } catch (err) {
    console.error('Failed to update your config automatically:', err)
    console.log(manualInstructions(agent))
    process.exit(1)
  }
}

setup().catch(console.error)
