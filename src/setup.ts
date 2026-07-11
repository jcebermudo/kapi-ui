#!/usr/bin/env node
import { installKapi, injectVitePlugin, injectNuxtModule, detectFramework, KAPI_PACKAGE_NAME, type Framework } from './utils.js'

const FRAMEWORK_SETUP: Record<
  Framework,
  { label: string; inject: (cwd: string) => Promise<void>; manualInstructions: string }
> = {
  nuxt: {
    label: 'Nuxt',
    inject: injectNuxtModule,
    manualInstructions: `
Add this manually to your nuxt.config:

  export default defineNuxtConfig({
    modules: ['${KAPI_PACKAGE_NAME}/nuxt'],
  })
`,
  },
  vite: {
    label: 'Vite + Vue',
    inject: injectVitePlugin,
    manualInstructions: `
Add this manually to your vite.config:

  import kapi from '${KAPI_PACKAGE_NAME}/vite-plugin'

  export default defineConfig({
    plugins: [kapi()],
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

async function setup() {
  console.log(`
██   ██  █████  ██████  ██ 
██  ██  ██   ██ ██   ██ ██ 
█████   ███████ ██████  ██ 
██  ██  ██   ██ ██      ██ 
██   ██ ██   ██ ██      ██                            
  `);

  const response = await prompts({
    type: 'select',
    name: 'setupChoice',
    message: 'Setup',
    choices: [
      { title: 'Vite', value: 'vite'},
      { title: 'Nuxt', value: 'nuxt'},
    ],
  })

  if (!response.setupChoice) {
    console.log('Setup cancelled.')
    process.exit(0)
  }

  const { label, inject, manualInstructions } = FRAMEWORK_SETUP[framework]
  console.log(`\n✨ Detected ${label} — setting up kapi...\n`)

  try {
    installKapi(cwd)
    await inject(cwd)
    console.log('done!')
  } catch (err) {
    console.error('Failed to update your config automatically:', err)
    console.log(manualInstructions)
    process.exit(1)
  }
}

setup().catch(console.error)
