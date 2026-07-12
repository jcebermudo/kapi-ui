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
  let serverPort: number | null = null
  const vueFileRegex = /\.vue$/

  return {
    name: 'kapi-ui',
    enforce: 'pre',
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
    configureServer() {
      startServer(KAPI_SERVER_PORT)
        .then(port => {
          serverPort = port
        })
        .catch(err => {
          console.error('[kapi] failed to start server', err)
        })
    },
    resolveId(id: string) {
      if (id === '/@kapi-ui/overlay') return overlayPath
    },
    transform: {
      filter: {
        id: vueFileRegex,
      },
      handler(code: string, id: string) {
        const [bareId] = id.split('?')
        if (!bareId.endsWith('.vue')) return
        if (bareId.includes('/node_modules/')) return
        const relativeFile = path.relative(process.cwd(), bareId)
        return { code: stampTemplateLocations(code, relativeFile), map: null }
      },
    },
    async transformIndexHtml(html: string) {
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
