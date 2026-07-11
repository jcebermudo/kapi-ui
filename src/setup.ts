#!/usr/bin/env node
import { installKapi, injectVitePlugin, injectNuxtModule, detectFramework, KAPI_PACKAGE_NAME, type Framework } from './utils.js'

function parseFrameworkFlag(): Framework | null {
  const args = process.argv.slice(2)
  if (args.includes('--nuxt')) return 'nuxt'
  if (args.includes('--vite')) return 'vite'
  return null
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

  console.log(`\n✨ Detected ${framework === 'nuxt' ? 'Nuxt' : 'Vite + Vue'} — setting up kapi...\n`)

  try {
    installKapi(cwd)
    if (framework === 'nuxt') {
      await injectNuxtModule(cwd)
    } else {
      await injectVitePlugin(cwd)
    }
    console.log('done!')
  } catch (err) {
    console.error('Failed to update your config automatically:', err)
    if (framework === 'nuxt') {
      console.log(`
Add this manually to your nuxt.config:

  export default defineNuxtConfig({
    modules: ['${KAPI_PACKAGE_NAME}/nuxt'],
  })
`)
    } else {
      console.log(`
Add this manually to your vite.config:

  import kapi from '${KAPI_PACKAGE_NAME}/vite-plugin'

  export default defineConfig({
    plugins: [kapi()],
  })
`)
    }
    process.exit(1)
  }
}

setup().catch(console.error)
