import path from 'path'
import { fileURLToPath } from 'url'
import type { Plugin, HtmlTagDescriptor } from 'vite'
import { searchForWorkspaceRoot } from 'vite'
import { walk } from 'estree-walker'
import MagicString from 'magic-string'
import { SourceMapConsumer } from 'source-map-js'
import { claudeAgent } from './claude-agent.js'
import { codexAgent } from './codex-agent.js'
import type { KapiOptions, KapiAgent, AgentClient } from './types.js'

export type { KapiOptions, KapiAgent } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const overlayPath = path.resolve(__dirname, '../browser/overlay.js')
const traceRecordPath = path.resolve(__dirname, '../browser/trace-record.js')

// Names Vue's SFC compiler emits in a component's compiled render function
// for every vnode it creates. Wrapping calls to these — rather than parsing
// the original template — means coverage always matches whatever Vue itself
// just compiled, including dynamic `h()` calls a template-source parser would
// never see.
const VNODE_FUNCTIONS = [
  'h',
  '_createElementVNode',
  '_createElementBlock',
  '_createBlock',
  '_createVNode',
  '_createStaticVNode',
]
const vnodeCallRe = new RegExp(`\\b(?:${VNODE_FUNCTIONS.join('|')})\\(`)
const INSTRUMENTED_MARKER = '/* kapi-ui:instrumented */'

// Byte offset of the start of each line (line 1 starts at offset 0). Built
// once per file so looking up a call's line/column is a binary search
// instead of re-scanning from the start of the file for every vnode call.
function buildLineOffsets(code: string): number[] {
  const offsets = [0]
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

function offsetToPos(lineOffsets: number[], index: number): { line: number; column: number } {
  let lo = 0
  let hi = lineOffsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineOffsets[mid]! <= index) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: index - lineOffsets[lo]! }
}

function createUniqueIdentifier(base: string, identifiers: Set<string>): string {
  let identifier = base
  let suffix = 1
  while (identifiers.has(identifier)) {
    identifier = `${base}_${suffix++}`
  }
  identifiers.add(identifier)
  return identifier
}

// Normalize + validate the `agent` option once, up front. `agent` is required
// (no default): a missing or bad value throws at dev-server startup with a
// clear message instead of silently falling back to Claude — which would be
// especially confusing for a value the user meant as "off" (e.g. 'none').
function resolveAgent(agent: KapiOptions['agent']): KapiAgent | false {
  if (agent === undefined) {
    throw new Error(
      "[kapi-ui] The `agent` option is required. Set it to 'claude', 'codex', or false (manual copy/paste).",
    )
  }
  if (agent === false) return false // manual copy/paste
  if (agent === 'claude' || agent === 'codex') return agent
  throw new Error(
    `[kapi-ui] Invalid \`agent\` option: ${JSON.stringify(agent)}. Use 'claude', 'codex', or false (manual copy/paste).`,
  )
}

export default function kapi(options: KapiOptions): Plugin {
  const agent = resolveAgent(options?.agent)
  let started = false

  return {
    name: 'kapi-ui',
    // Must run after @vitejs/plugin-vue has compiled templates into
    // vnode-creation calls — this transform rewrites that compiled output,
    // not the raw SFC source.
    enforce: 'post',
    apply: 'serve',
    config() {
      return {
        server: {
          fs: {
            allow: [searchForWorkspaceRoot(process.cwd()), path.dirname(overlayPath)],
          },
        },
      }
    },
    // Ride Vite's own HMR websocket instead of standing up a second server on
    // its own port: the overlay talks to us via custom HMR events (see
    // browser/socket.ts), and we dispatch them to the configured agent. In
    // Nuxt this runs too, since nuxt-module.ts registers this same plugin.
    configureServer(server) {
      if (agent === false) return // manual copy/paste only — no agent session
      if (started) return // configureServer can fire more than once; agent.start() must not
      started = true

      const cwd = process.cwd()
      const runtime = agent === 'codex' ? codexAgent : claudeAgent
      runtime.start(cwd)

      // Vite hands the event handler a fresh WebSocketClient wrapper but a
      // stable underlying `.socket` per connection; key one AgentClient per
      // socket so submit/stop/close all agree on identity and share a sender.
      const clients = new Map<object, AgentClient>()
      const clientFor = (c: { socket: object; send: (event: string, data?: unknown) => void }): AgentClient => {
        let existing = clients.get(c.socket)
        if (!existing) {
          existing = { send: (event, data) => c.send(event, data) }
          clients.set(c.socket, existing)
        }
        return existing
      }

      server.ws.on('kapi:submit', (data: { prompt: string }, client) => runtime.submit(data.prompt, clientFor(client), cwd))
      server.ws.on('kapi:stop', (_data, client) => runtime.stop(clientFor(client)))
      server.ws.on('connection', (socket) => {
        socket.on('close', () => {
          const existing = clients.get(socket)
          if (existing) {
            runtime.onClose(existing)
            clients.delete(socket)
          }
        })
      })
    },
    resolveId(id: string) {
      if (id === '/@kapi-ui/overlay') return overlayPath
      if (id === '/@kapi-ui/trace-record') return traceRecordPath
    },
    transform(code: string, id: string) {
      // `this.environment` only exists on Vite 6+ (the Environment API); vite
      // is a devDependency here, not a peerDependency, so kapi has no control
      // over the Vite version in the host project. Treat its absence as
      // "client" so pre-6 Vite still runs the transform instead of throwing
      // on every module.
      if (this.environment && this.environment.name !== 'client') return
      if (id.includes('/node_modules/')) return

      // Only Vue SFC compiled output contains this — cheap enough to check
      // before parsing every transformed module in the project.
      if (!code.includes('_sfc_render(')) return
      if (!vnodeCallRe.test(code)) return
      if (code.includes(INSTRUMENTED_MARKER)) return

      const map = this.getCombinedSourcemap()
      const consumer = new SourceMapConsumer(map as unknown as ConstructorParameters<typeof SourceMapConsumer>[0])
      const s = new MagicString(code)
      const ast = this.parse(code)
      const lineOffsets = buildLineOffsets(code)
      const identifiers = new Set<string>()
      let hit = false

      walk(ast, {
        enter(node) {
          if (node.type === 'Identifier') identifiers.add(node.name)
        },
      })

      // Vue's compiled render function shares the module's lexical scope, so
      // reserve names not used anywhere in the parsed module before injecting
      // either the import binding or the tracer helper.
      const recordPositionIdentifier = createUniqueIdentifier('__kapiRecordPosition', identifiers)
      const tracerIdentifier = createUniqueIdentifier('__kapiTracer', identifiers)

      walk(ast, {
        enter(node) {
          if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return
          if (!VNODE_FUNCTIONS.includes(node.callee.name)) return

          const { start, end } = node as { start: number; end: number }
          const original = consumer.originalPositionFor(offsetToPos(lineOffsets, start))
          if (original.source === null) return

          hit = true
          s.appendLeft(start, `${tracerIdentifier}(${original.line},${original.column},`)
          s.appendRight(end, ')')
        },
      })

      if (!hit) return

      const relativeFile = path.relative(process.cwd(), id.split('?')[0]!)
      s.prepend(`${INSTRUMENTED_MARKER}\nimport { recordPosition as ${recordPositionIdentifier} } from "/@kapi-ui/trace-record"\n`)
      s.append(
        `\nfunction ${tracerIdentifier}(line, column, vnode) { return ${recordPositionIdentifier}(${JSON.stringify(relativeFile)}, line, column, vnode) }\n`,
      )

      return { code: s.toString(), map: s.generateMap({ hires: true }) }
    },
    transformIndexHtml() {
      const tags: HtmlTagDescriptor[] = [
        {
          tag: 'script',
          attrs: { type: 'module', src: '/@kapi-ui/overlay' },
          injectTo: 'body',
        },
      ]
      // Tell the overlay the agent session is off so it hides the AI button.
      // Classic inline script runs before the deferred overlay module reads it.
      if (agent === false) {
        tags.unshift({
          tag: 'script',
          children: 'window.__KAPI_AGENT_ENABLED__=false',
          injectTo: 'body',
        })
      }
      return tags
    },
  }
}
