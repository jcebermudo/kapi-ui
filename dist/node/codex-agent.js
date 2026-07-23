// Mirrors claude-agent.ts's workflow: one session is established at server
// start (the KAPI_SESSION_PROMPT turn) and every later submission resumes it,
// so all tabs share one continuous session in submission order. The one thing
// codex can't do that Claude can: `codex exec` is one-shot (no stdin-driven
// warm process), so each turn still pays process cold-start — session
// continuity is preserved via `exec resume <id>`, but the process isn't warm.
// ponytail: cold-start per turn is inherent to `codex exec`; only a codex
// server/stdin mode could remove it — none exists in the CLI today.
import { spawn } from 'child_process';
const KAPI_SESSION_PROMPT = "You're applying UI edits from visual comments. Each comment gives the exact file:line:col — go straight there, don't search for it. Make only the requested edit. " +
    'Before finishing, check whether a higher-precedence rule on the same element would override the property you just changed — an inline `style` attribute, `!important`, a more specific selector, or a utility class applied after it. You have no way to see the rendered result, so if such a conflict exists, edit the highest-precedence source instead of (or in addition to) the one you found first, so the change actually takes visible effect. ' +
    'Stay terse: no narration between steps, and finish with at most one short sentence.';
function startSession(cwd, prompt) {
    return spawn('codex', ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--cd', cwd, prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}
function resumeSession(activeSession, prompt) {
    return spawn('codex', ['exec', 'resume', activeSession.id, '--json', '--skip-git-repo-check', prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}
function sessionIdFromEvent(event) {
    return typeof event?.thread_id === 'string' ? event.thread_id : null;
}
function describeEvent(event) {
    const item = event?.item;
    if (item?.type === 'command_execution' && item.command)
        return `Running: ${String(item.command).slice(0, 60)}`;
    if (item?.type === 'agent_message' && item.text)
        return String(item.text).slice(0, 120);
    if (item?.type === 'file_change' && item.path)
        return `Editing ${item.path}`;
    return null;
}
let cwd = process.cwd();
let session = null;
let child = null;
let busy = false; // a turn is currently running
// Which client to notify when the running turn finishes. Null for the startup
// turn that sends KAPI_SESSION_PROMPT — there's no tab yet.
let activeClient = null;
// FIFO queue of turns waiting for the current one to finish. The first entry,
// queued at server startup, is the KAPI_SESSION_PROMPT itself.
const pendingPrompts = [];
function processQueue() {
    if (busy || pendingPrompts.length === 0)
        return;
    const next = pendingPrompts.shift();
    busy = true;
    activeClient = next.client;
    next.client?.send('kapi:processing', { status: session ? 'Continuing session...' : 'Starting Codex...' });
    const proc = session ? resumeSession(session, next.prompt) : startSession(cwd, next.prompt);
    child = proc;
    let buffer = '';
    let failed = false;
    const handleEvent = (event) => {
        const nextSessionId = sessionIdFromEvent(event);
        if (nextSessionId && nextSessionId !== session?.id) {
            session = { agent: 'codex', id: nextSessionId };
            console.log(`[kapi] codex session started: ${nextSessionId}`);
        }
        const status = describeEvent(event);
        if (status)
            activeClient?.send('kapi:processing', { status });
    };
    proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!line)
                continue;
            try {
                handleEvent(JSON.parse(line));
            }
            catch {
                // Ignore non-JSON progress from a CLI and continue reading its stream.
            }
        }
    });
    proc.stderr.pipe(process.stderr);
    proc.on('error', (error) => {
        failed = true;
        activeClient?.send('kapi:error', { message: error.message });
    });
    proc.on('close', (code) => {
        if (buffer.trim()) {
            try {
                handleEvent(JSON.parse(buffer));
            }
            catch {
                // A final non-JSON line is only CLI output, not a Kapi protocol event.
            }
        }
        if (code !== 0 && !proc.killed && !failed) {
            activeClient?.send('kapi:error', { message: `codex exited with code ${code}.` });
        }
        else if (!failed) {
            activeClient?.send('kapi:done');
        }
        if (child === proc)
            child = null;
        busy = false;
        activeClient = null;
        processQueue();
    });
}
export const codexAgent = {
    start(startCwd) {
        cwd = startCwd;
        // Establish the session up front (before any tab connects) so the user's
        // first real submission resumes an existing session instead of creating one.
        pendingPrompts.push({ prompt: KAPI_SESSION_PROMPT, client: null });
        processQueue();
    },
    submit(prompt, client) {
        pendingPrompts.push({ prompt, client });
        processQueue();
    },
    stop(client) {
        // Drop anything this client queued but hasn't started.
        for (let i = pendingPrompts.length - 1; i >= 0; i--) {
            if (pendingPrompts[i].client === client)
                pendingPrompts.splice(i, 1);
        }
        // Kill the running turn only if it's this client's. The close handler
        // clears state and starts the next queued turn (resuming the session).
        if (activeClient === client && child) {
            console.log('[kapi] stopping codex process');
            child.kill();
        }
    },
    onClose(client) {
        codexAgent.stop(client);
    },
};
