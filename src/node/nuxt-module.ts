import { defineNuxtModule, addVitePlugin } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import kapiVitePlugin from './vite-plugin.js'
import type { KapiOptions } from './vite-plugin.js'

export default defineNuxtModule<KapiOptions>({
  meta: {
    name: 'kapi-ui',
    configKey: 'kapi',
  },
  setup(options: KapiOptions, nuxt: Nuxt) {
    if (!nuxt.options.dev) return

    // The vite plugin does everything now — instrumentation, the overlay
    // module, and wiring the agent onto Vite's HMR websocket (its
    // configureServer hook). Registering it here means Nuxt's Vite server
    // gets that wiring too; the overlay talks back over the same HMR channel
    // Nitro already proxies, so there's no separate port to inject.
    addVitePlugin(kapiVitePlugin(options))

    // Nitro renders HTML, not Vite's transformIndexHtml, so the overlay script
    // still has to be injected here via unhead. Nuxt mounts Vite's dev
    // middleware under app.buildAssetsDir (e.g. /_nuxt/), not at the site
    // root, so request it from under that prefix or Nitro's page renderer
    // intercepts it before Vite ever sees it.
    nuxt.options.app.head.script ||= []
    nuxt.options.app.head.script.push({
      src: `${nuxt.options.app.buildAssetsDir}@kapi-ui/overlay`,
      type: 'module',
    })
  },
})
