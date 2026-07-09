import { loadFile, writeFile } from 'magicast'
import { addVitePlugin } from 'magicast/helpers'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

// dist/utils.js -> package root (one level up from dist/)
const kapiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kapiPkg = JSON.parse(readFileSync(path.join(kapiRoot, 'package.json'), 'utf-8'))
export const KAPI_PACKAGE_NAME: string = kapiPkg.name

export function installKapi(cwd: string) {
  console.log(`Installing ${KAPI_PACKAGE_NAME}...`)
  execSync(`npm install ${KAPI_PACKAGE_NAME} -D`, { cwd, stdio: 'inherit' })
}

export async function injectVitePlugin(cwd: string) {
  const candidates = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']
  const configFile = candidates.find((f) => existsSync(path.join(cwd, f)))

  if (!configFile) {
    throw new Error('No vite.config found.')
  }

  const configPath = path.join(cwd, configFile)
  const importSpecifier = `${KAPI_PACKAGE_NAME}/vite-plugin`

  const existingSource = readFileSync(configPath, 'utf-8')
  if (existingSource.includes(importSpecifier)) {
    console.log(`✔ kapi plugin already configured in ${configFile}`)
    return
  }

  const mod = await loadFile(configPath)

  addVitePlugin(mod, {
    from: importSpecifier,
    imported: 'default',
    constructor: 'kapi'
  })

  await writeFile(mod, configPath)
  console.log(`✔ Added kapi plugin to ${configFile}`)
}
