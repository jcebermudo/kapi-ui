import { defineNuxtModule, addVitePlugin } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import kapiVitePlugin from './vite-plugin.js'
import type { KapiOptions } from './vite-plugin.js'
import { startServer } from './server.js'
import { KAPI_SERVER_PORT } from '../constants.js'

export default defineNuxtModule<KapiOptions>({
  meta: {
    name: 'kapi-ui',
    configKey: 'kapi',
  },
  async setup(options: KapiOptions, nuxt: Nuxt) {
    if (!nuxt.options.dev) return

    // Nuxt renders HTML through Nitro, not Vite's transformIndexHtml, so the
    // overlay script (and the port it connects to) has to be injected via
    // unhead instead of the vite plugin.
    addVitePlugin(kapiVitePlugin(options))

    const serverPort = await startServer(KAPI_SERVER_PORT, options)

    // Nuxt mounts Vite's dev middleware under app.buildAssetsDir (e.g. /_nuxt/),
    // not at the site root, so the script has to be requested from under that
    // prefix or Nitro's page renderer intercepts it before Vite ever sees it.
    nuxt.options.app.head.script ||= []
    nuxt.options.app.head.script.push(
      {
        innerHTML: `window.__KAPI_PORT__ = ${serverPort}`,
      },
      {
        src: `${nuxt.options.app.buildAssetsDir}@kapi-ui/overlay`,
        type: 'module',
      },
    )
  },
})
