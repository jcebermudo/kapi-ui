import { loadFile, writeFile } from 'magicast';
import { addVitePlugin } from 'magicast/helpers';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
// dist/utils.js -> package root (one level up from dist/)
const kapiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// kapi isn't published yet, so pack it into a tarball and install that
// directly -- avoids the npm-link global-registration bootstrap problem
// entirely, and installs like a real package (copied, not symlinked).
function packKapi() {
    const pkg = JSON.parse(readFileSync(path.join(kapiRoot, 'package.json'), 'utf-8'));
    const tarballName = `${pkg.name}-${pkg.version}.tgz`;
    console.log('Packing kapi...');
    execSync('npm pack', { cwd: kapiRoot, stdio: 'inherit' });
    return path.join(kapiRoot, tarballName);
}
export function installKapi(cwd) {
    const tarballPath = packKapi();
    console.log('Installing kapi...');
    execSync(`npm install ${JSON.stringify(tarballPath)} -D`, { cwd, stdio: 'inherit' });
}
export async function injectVitePlugin(cwd) {
    const candidates = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];
    const configFile = candidates.find((f) => existsSync(path.join(cwd, f)));
    if (!configFile) {
        throw new Error('No vite.config found.');
    }
    const configPath = path.join(cwd, configFile);
    const existingSource = readFileSync(configPath, 'utf-8');
    if (existingSource.includes('kapi/vite-plugin')) {
        console.log(`✔ kapi plugin already configured in ${configFile}`);
        return;
    }
    const mod = await loadFile(configPath);
    addVitePlugin(mod, {
        from: 'kapi/vite-plugin',
        imported: 'default',
        constructor: 'kapi'
    });
    await writeFile(mod, configPath);
    console.log(`✔ Added kapi plugin to ${configFile}`);
}
