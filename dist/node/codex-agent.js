// Codex spawns a fresh `codex exec` process per submission, resuming
// continuity via a session id (--resume). Unlike Claude, it has no
// stdin-driven persistent mode, so there's no warm process to keep alive.
import { spawn } from 'child_process';
import { send } from './ws-utils.js';
function startSession(cwd, prompt) {
    return spawn('codex', ['exec', '--json', '--sandbox', 'workspace-write', '--cd', cwd, prompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}
function resumeSession(activeSession, prompt) {
    return spawn('codex', ['exec', 'resume', activeSession.id, '--json', prompt], {
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
let session = null;
const processBySocket = new WeakMap();
async function submitPrompt(prompt, socket, cwd) {
    const isNewSession = session === null;
    send(socket, { type: 'comments:processing', status: isNewSession ? 'Starting Codex...' : 'Continuing session...' });
    const child = isNewSession ? startSession(cwd, prompt) : resumeSession(session, prompt);
    processBySocket.set(socket, child);
    let buffer = '';
    let failed = false;
    const handleEvent = (event) => {
        const nextSessionId = sessionIdFromEvent(event);
        if (nextSessionId) {
            session = { agent: 'codex', id: nextSessionId };
            console.log(`[kapi] codex session started: ${nextSessionId}`);
        }
        const status = describeEvent(event);
        if (status)
            send(socket, { type: 'comments:processing', status });
    };
    child.stdout.on('data', (chunk) => {
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
    child.stderr.pipe(process.stderr);
    child.on('error', (error) => {
        failed = true;
        send(socket, { type: 'comments:error', message: error.message });
    });
    child.on('close', (code) => {
        if (buffer.trim()) {
            try {
                handleEvent(JSON.parse(buffer));
            }
            catch {
                // A final non-JSON line is only CLI output, not a Kapi protocol event.
            }
        }
        processBySocket.delete(socket);
        if (code !== 0 && !child.killed && !failed) {
            send(socket, { type: 'comments:error', message: `codex exited with code ${code}.` });
        }
        else if (!failed) {
            send(socket, { type: 'comments:done' });
        }
    });
}
function stop(socket) {
    const child = processBySocket.get(socket);
    if (child) {
        console.log('[kapi] stopping codex process');
        child.kill();
        processBySocket.delete(socket);
    }
}
export const codexAgent = {
    // No persistent process to warm — each submission spawns its own.
    start() { },
    submit(prompt, socket, cwd) {
        void submitPrompt(prompt, socket, cwd);
    },
    stop,
    onClose(socket) {
        stop(socket);
    },
};
