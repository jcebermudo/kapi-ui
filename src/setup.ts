#!/usr/bin/env node
import prompts from 'prompts'
import { installKapi, injectVitePlugin, injectNuxtModule, KAPI_PACKAGE_NAME } from './utils.js'

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

  console.log(`\n✨ Setting up Kapi for ${response.setupChoice}...\n`)

  if (response.setupChoice === 'vite') {
    try {
      installKapi(process.cwd())
      await injectVitePlugin(process.cwd())
      console.log('done!')
    } catch (err) {
      console.error('Failed to update vite.config automatically:', err)
      console.log(`
Add this manually to your vite.config:

  import kapi from '${KAPI_PACKAGE_NAME}/vite-plugin'

  export default defineConfig({
    plugins: [kapi()],
  })
`)
      process.exit(1)
    }
  }

  if (response.setupChoice === 'nuxt') {
    try {
      installKapi(process.cwd())
      await injectNuxtModule(process.cwd())
      console.log('done!')
    } catch (err) {
      console.error('Failed to update nuxt.config automatically:', err)
      console.log(`
Add this manually to your nuxt.config:

  export default defineNuxtConfig({
    modules: ['${KAPI_PACKAGE_NAME}/nuxt'],
  })
`)
      process.exit(1)
    }
  }
}

setup().catch(console.error)
