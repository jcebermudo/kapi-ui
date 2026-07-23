#!/usr/bin/env node
import { stdin as input, stdout as output } from 'process';
import { installKapi, injectVitePlugin, injectNuxtModule, detectFramework, detectInstalledAgents, KAPI_PACKAGE_NAME, } from './utils.js';
// How the chosen agent renders in config: a quoted agent name, or bare `false`
// for the manual copy/paste-only workflow.
const agentConfigValue = (agent) => (agent === false ? 'false' : `'${agent}'`);
const FRAMEWORK_SETUP = {
    nuxt: {
        label: 'Nuxt',
        inject: injectNuxtModule,
        manualInstructions: (agent) => `
Add this manually to your nuxt.config:

  export default defineNuxtConfig({
    modules: ['${KAPI_PACKAGE_NAME}/nuxt'],
    kapi: { agent: ${agentConfigValue(agent)} },
  })
`,
    },
    vite: {
        label: 'Vite + Vue',
        inject: injectVitePlugin,
        manualInstructions: (agent) => `
Add this manually to your vite.config:

  import kapi from '${KAPI_PACKAGE_NAME}/vite-plugin'

  export default defineConfig({
    plugins: [kapi({ agent: ${agentConfigValue(agent)} })],
  })
`,
    },
};
const AGENT_LABELS = {
    claude: 'Claude Code',
    codex: 'Codex (experimental)',
};
const modeLabel = (agent) => (agent === false ? 'manual copy/paste' : AGENT_LABELS[agent]);
// Minimal dependency-free single-select list: renders bulleted options and
// lets the user move with ↑/↓ (or j/k) and confirm with Enter, redrawing the
// list in place. Falls back to the default option when stdin isn't a TTY
// (piped/CI), where raw-mode key reading isn't available.
function promptSelect(question, options, defaultIndex = 0) {
    return new Promise((resolve) => {
        if (!input.isTTY) {
            resolve(options[defaultIndex].value);
            return;
        }
        let index = defaultIndex;
        const render = (redraw) => {
            if (redraw)
                output.write(`[${options.length}A`); // move up over the option lines
            for (let i = 0; i < options.length; i++) {
                const selected = i === index;
                // ● highlighted (cyan) for the current row, ○ for the rest.
                const line = selected ? `[36m❯ ● ${options[i].label}[0m` : `  ○ ${options[i].label}`;
                output.write(`[2K${line}\n`); // clear line, then draw
            }
        };
        const cleanup = () => {
            input.off('data', onData);
            input.setRawMode(false);
            input.pause();
            output.write('[?25h'); // show cursor
        };
        const onData = (data) => {
            const key = data.toString();
            if (key === '') {
                // Ctrl+C
                cleanup();
                output.write('\n');
                process.exit(130);
            }
            else if (key === '[A' || key === 'k') {
                index = (index - 1 + options.length) % options.length;
                render(true);
            }
            else if (key === '[B' || key === 'j') {
                index = (index + 1) % options.length;
                render(true);
            }
            else if (key === '\r' || key === '\n') {
                cleanup();
                resolve(options[index].value);
            }
        };
        output.write(`${question}\n[2m(↑/↓ to move · Enter to select)[0m\n`);
        output.write('[?25l'); // hide cursor
        render(false);
        input.setRawMode(true);
        input.resume();
        input.on('data', onData);
    });
}
function parseFrameworkFlag() {
    const args = process.argv.slice(2);
    if (args.includes('--nuxt'))
        return 'nuxt';
    if (args.includes('--vite'))
        return 'vite';
    return null;
}
function parseAgentFlag() {
    const args = process.argv.slice(2);
    const inlineValue = args.find((arg) => arg.startsWith('--agent='))?.split('=')[1];
    if (inlineValue === 'claude' || inlineValue === 'codex')
        return inlineValue;
    if (inlineValue)
        throw new Error(`Unknown agent "${inlineValue}". Use "claude" or "codex".`);
    const flagIndex = args.indexOf('--agent');
    const value = flagIndex === -1 ? undefined : args[flagIndex + 1];
    if (flagIndex === -1)
        return null;
    if (value === 'claude' || value === 'codex')
        return value;
    throw new Error('Missing or invalid --agent value. Use "claude" or "codex".');
}
// `--manual` (or `--agent=false`/`--agent=none`) forces the copy/paste-only
// workflow without prompting.
function parseManualFlag() {
    const args = process.argv.slice(2);
    if (args.includes('--manual'))
        return true;
    const inline = args.find((arg) => arg.startsWith('--agent='))?.split('=')[1];
    return inline === 'false' || inline === 'none';
}
async function chooseMode() {
    if (parseManualFlag())
        return false;
    const requestedAgent = parseAgentFlag();
    const installedAgents = detectInstalledAgents();
    if (requestedAgent) {
        if (!installedAgents.includes(requestedAgent)) {
            throw new Error(`${requestedAgent} CLI is not installed. Install it, or run setup with --manual.`);
        }
        return requestedAgent;
    }
    // No agent installed → nothing to send to, so set up the manual workflow.
    if (installedAgents.length === 0) {
        console.log('No coding agent (Claude Code or Codex) detected — setting up the manual copy/paste workflow.');
        return false;
    }
    const useAgent = await promptSelect('How should Kapi handle your comments?', [
        { label: 'Send them to a coding agent', value: true },
        { label: 'Manual copy & paste only', value: false },
    ]);
    if (!useAgent)
        return false;
    if (installedAgents.length === 1)
        return installedAgents[0];
    return promptSelect('Which coding agent should Kapi use?', installedAgents.map((agent) => ({ label: AGENT_LABELS[agent], value: agent })));
}
async function setup() {
    console.log(`
██   ██  █████  ██████  ██
██  ██  ██   ██ ██   ██ ██
█████   ███████ ██████  ██
██  ██  ██   ██ ██      ██
██   ██ ██   ██ ██      ██
  `);
    const cwd = process.cwd();
    const framework = parseFrameworkFlag() ?? detectFramework(cwd);
    if (!framework) {
        console.error(`Could not detect a Vue project in ${cwd}.`);
        console.error(`kapi-ui only supports Vue apps (Vite + Vue, or Nuxt).`);
        console.error(`If this is a Vue project, re-run with --vite or --nuxt to skip detection.`);
        process.exit(1);
    }
    let agent;
    try {
        agent = await chooseMode();
    }
    catch (err) {
        console.error(`Unable to choose a coding agent: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
    const { label, inject, manualInstructions } = FRAMEWORK_SETUP[framework];
    console.log(`\n✨ Detected ${label}; using ${modeLabel(agent)} — setting up kapi...\n`);
    try {
        installKapi(cwd);
        await inject(cwd, agent);
        console.log('done!');
    }
    catch (err) {
        console.error('Failed to update your config automatically:', err);
        console.log(manualInstructions(agent));
        process.exit(1);
    }
}
setup().catch(console.error);
