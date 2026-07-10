import { defineNuxtModule, addVitePlugin } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import kapiVitePlugin from './vite-plugin.js'

export default defineNuxtModule<Record<string, never>>({
  meta: {
    name: 'kapi-ui',
    configKey: 'kapi',
  },
  setup(_options: Record<string, never>, nuxt: Nuxt) {
    if (!nuxt.options.dev) return

    // Nuxt renders HTML through Nitro, not Vite's transformIndexHtml, so the
    // overlay script has to be injected via unhead instead of the vite plugin.
    addVitePlugin(kapiVitePlugin())

    nuxt.options.app.head.script ||= []
    nuxt.options.app.head.script.push({
      src: '/@kapi-ui/overlay',
      type: 'module',
    })
  },
})
