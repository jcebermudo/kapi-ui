import path from 'path'
import { fileURLToPath } from 'url'
import type { Plugin } from 'vite'
import { searchForWorkspaceRoot } from 'vite'
import { startServer } from './server.js'
import { stampTemplateLocations } from './location-transform.js'
import { KAPI_SERVER_PORT } from '../constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const overlayPath = path.resolve(__dirname, '../browser/overlay.js')

export default function kapi(): Plugin {
  let isDev = false
  let serverPort: number | null = null

  return {
    name: 'kapi-ui',
    enforce: 'pre',
    config(_config, { command }) {
      isDev = command === 'serve'
      return {
        server: {
          fs: {
            allow: [searchForWorkspaceRoot(process.cwd()), path.dirname(overlayPath)],
          },
        },
      }
    },
    configureServer() {
      startServer(KAPI_SERVER_PORT).then(port => {
        serverPort = port
      })
    },
    resolveId(id: string) {
      if (id === '/@kapi-ui/overlay') return overlayPath
    },
    transform(code: string, id: string) {
      if (!isDev) return
      const [bareId] = id.split('?')
      if (!bareId.endsWith('.vue')) return
      if (bareId.includes('/node_modules/')) return

      const relativeFile = path.relative(process.cwd(), bareId)
      return { code: stampTemplateLocations(code, relativeFile), map: null }
    },
    async transformIndexHtml(html: string) {
      if (!isDev) return
      if (serverPort === null) {
        serverPort = await startServer(KAPI_SERVER_PORT)
      }
      return {
        html,
        tags: [
          {
            tag: 'script',
            children: `window.__KAPI_PORT__ = ${serverPort}`,
            injectTo: 'body',
          },
          {
            tag: 'script',
            attrs: { type: 'module', src: '/@kapi-ui/overlay' },
            injectTo: 'body',
          },
        ],
      }
    },
  }
}
