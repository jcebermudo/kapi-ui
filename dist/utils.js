import { loadFile, writeFile } from 'magicast';
import { addVitePlugin, addNuxtModule } from 'magicast/helpers';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
// dist/utils.js -> package root (one level up from dist/)
const kapiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kapiPkg = JSON.parse(readFileSync(path.join(kapiRoot, 'package.json'), 'utf-8'));
export const KAPI_PACKAGE_NAME = kapiPkg.name;
export function installKapi(cwd) {
    console.log(`Installing ${KAPI_PACKAGE_NAME}...`);
    execSync(`npm install ${KAPI_PACKAGE_NAME} -D`, { cwd, stdio: 'inherit' });
}
const NUXT_CONFIG_CANDIDATES = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs', 'nuxt.config.mts', 'nuxt.config.cjs'];
// kapi only supports Vue apps, so setup detects which of the two Vue build
// tools it's dealing with instead of asking — a nuxt.config file means Nuxt
// (Nuxt apps don't always list `vue` as a direct dependency), otherwise a
// `vue` dependency means a plain Vite + Vue app.
export function detectFramework(cwd) {
    if (NUXT_CONFIG_CANDIDATES.some((f) => existsSync(path.join(cwd, f))))
        return 'nuxt';
    const pkgPath = path.join(cwd, 'package.json');
    if (!existsSync(pkgPath))
        return null;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const hasVue = Boolean(pkg.dependencies?.vue || pkg.devDependencies?.vue);
    return hasVue ? 'vite' : null;
}
export async function injectVitePlugin(cwd) {
    const candidates = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];
    const configFile = candidates.find((f) => existsSync(path.join(cwd, f)));
    if (!configFile) {
        throw new Error('No vite.config found.');
    }
    const configPath = path.join(cwd, configFile);
    const importSpecifier = `${KAPI_PACKAGE_NAME}/vite-plugin`;
    const existingSource = readFileSync(configPath, 'utf-8');
    if (existingSource.includes(importSpecifier)) {
        console.log(`✔ kapi plugin already configured in ${configFile}`);
        return;
    }
    const mod = await loadFile(configPath);
    addVitePlugin(mod, {
        from: importSpecifier,
        imported: 'default',
        constructor: 'kapi'
    });
    await writeFile(mod, configPath);
    console.log(`✔ Added kapi plugin to ${configFile}`);
}
export async function injectNuxtModule(cwd) {
    const candidates = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'];
    const configFile = candidates.find((f) => existsSync(path.join(cwd, f)));
    if (!configFile) {
        throw new Error('No nuxt.config found.');
    }
    const configPath = path.join(cwd, configFile);
    const moduleSpecifier = `${KAPI_PACKAGE_NAME}/nuxt`;
    const existingSource = readFileSync(configPath, 'utf-8');
    if (existingSource.includes(moduleSpecifier)) {
        console.log(`✔ kapi module already configured in ${configFile}`);
        return;
    }
    const mod = await loadFile(configPath);
    // Nuxt renders HTML through Nitro, not Vite's transformIndexHtml, so the
    // overlay can't be injected as a plain Vite plugin the way it is for Vite
    // apps. Registering it as a Nuxt module (kapi-ui/nuxt) lets it inject the
    // overlay script via unhead and add the Vite plugin through @nuxt/kit.
    addNuxtModule(mod, moduleSpecifier);
    await writeFile(mod, configPath);
    console.log(`✔ Added kapi module to ${configFile}`);
}
