// One warm `claude -p --input-format stream-json` process serves every
// submission, across every tab (they share one session anyway — see
// kapi/CLAUDE.md's Session Management section). This avoids CLI cold-start
// and --resume-from-disk overhead on each comment: the process, its
// tool-use context, and the prompt cache all stay warm between submissions.
import { spawn } from 'child_process';
const KAPI_SESSION_PROMPT = "You're applying UI edits from visual comments. Each comment gives the exact file:line:col — go straight there, don't search for it. Make only the requested edit. " +
    "Before finishing, check whether a higher-precedence rule on the same element would override the property you just changed — an inline `style` attribute, `!important`, a more specific selector, or a utility class applied after it. You have no way to see the rendered result, so if such a conflict exists, edit the highest-precedence source instead of (or in addition to) the one you found first, so the change actually takes visible effect. " +
    "Stay terse: no narration between tool calls, and finish with at most one short sentence.";
function describeToolUse(name, input) {
    switch (name) {
        case 'Read':
            return `Reading ${input?.file_path ?? 'a file'}`;
        case 'Edit':
        case 'Write':
            return `Editing ${input?.file_path ?? 'a file'}`;
        case 'Bash':
            return `Running: ${String(input?.command ?? '').slice(0, 60)}`;
        case 'Grep':
            return `Searching for "${input?.pattern ?? ''}"`;
        case 'Glob':
            return `Finding files matching ${input?.pattern ?? ''}`;
        default:
            return `Using ${name}`;
    }
}
function sessionIdFromEvent(event) {
    return typeof event?.session_id === 'string' ? event.session_id : null;
}
function describeEvent(event) {
    if (event?.type !== 'assistant' || !event.message?.content)
        return null;
    for (const block of event.message.content) {
        if (block.type === 'tool_use')
            return describeToolUse(block.name, block.input);
        if (block.type === 'text' && block.text)
            return block.text.slice(0, 120);
        // Thinking content isn't exposed by the API (comes back redacted/empty),
        // but the block itself still arrives — surface it so "Starting..."
        // doesn't sit frozen for the several seconds Claude spends reasoning
        // before its first visible tool call.
        if (block.type === 'thinking')
            return 'Thinking...';
    }
    return null;
}
let cwd = process.cwd();
let sessionId = null;
let claudeProc = null;
let busy = false; // a turn is currently running on the process
// Which client to notify when the running turn finishes. Null for the
// startup turn that sends KAPI_SESSION_PROMPT — there's no tab yet.
let activeClient = null;
// FIFO queue of turns waiting for the process to free up. The very first
// entry, queued at server startup, is the KAPI_SESSION_PROMPT itself.
const pendingPrompts = [];
function ensureClaudeProc() {
    if (claudeProc && claudeProc.exitCode === null)
        return claudeProc;
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Edit,Write'];
    if (sessionId)
        args.push('--resume', sessionId);
    let claude;
    try {
        claude = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    }
    catch (err) {
        console.error('[kapi] failed to spawn claude:', err);
        return null;
    }
    claudeProc = claude;
    let buffer = '';
    claude.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!line)
                continue;
            let event;
            try {
                event = JSON.parse(line);
            }
            catch {
                continue;
            }
            const nextSessionId = sessionIdFromEvent(event);
            if (nextSessionId && nextSessionId !== sessionId) {
                sessionId = nextSessionId;
                console.log(`[kapi] claude session started: ${sessionId}`);
            }
            if (event.type === 'result') {
                // Turn finished — notify the submitter (if any) and start the next queued turn.
                busy = false;
                activeClient?.send('kapi:done');
                activeClient = null;
                processQueue();
                continue;
            }
            const status = describeEvent(event);
            if (status)
                activeClient?.send('kapi:processing', { status });
        }
    });
    claude.stderr.pipe(process.stderr);
    claude.on('error', (err) => {
        console.error('[kapi] claude process error:', err);
    });
    // Writes to stdin can outrace process teardown (e.g. right after a kill()
    // from stop()); without this listener that throws an uncaught EPIPE.
    claude.stdin.on('error', (err) => {
        console.error('[kapi] claude stdin error:', err);
    });
    claude.on('close', () => {
        if (claudeProc === claude)
            claudeProc = null;
        // A queued turn (or the killed-and-stopped one's successor) respawns
        // the process, resuming the same session via --resume.
        busy = false;
        processQueue();
    });
    return claude;
}
function processQueue() {
    if (busy || pendingPrompts.length === 0)
        return;
    const claude = ensureClaudeProc();
    if (!claude || !claude.stdin) {
        console.error('[kapi] cannot process comments: claude process unavailable');
        // Nothing will retry this later, so drain the whole backlog now rather
        // than stranding everything behind the first failed prompt.
        const stranded = pendingPrompts.splice(0, pendingPrompts.length);
        for (const { client } of stranded)
            client?.send('kapi:done');
        return;
    }
    const next = pendingPrompts.shift();
    busy = true;
    activeClient = next.client;
    next.client?.send('kapi:processing', { status: 'Starting...' });
    try {
        claude.stdin.write(JSON.stringify({
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text: next.prompt }] },
        }) + '\n');
    }
    catch (err) {
        console.error('[kapi] failed to write prompt to claude stdin:', err);
        busy = false;
        activeClient = null;
        processQueue();
    }
}
export const claudeAgent = {
    start(startCwd) {
        cwd = startCwd;
        // Send the kapi instructions as the session's first turn, before any
        // tab connects — also warms Claude's prompt cache so the user's actual
        // first submission (turn 2) doesn't pay a cold-cache latency hit.
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
        if (activeClient === client && claudeProc) {
            console.log('[kapi] stopping claude process');
            claudeProc.kill();
            // close handler respawns the process (resuming the session) so the
            // next queued turn — from any tab — continues normally.
        }
    },
    onClose(client) {
        // A closed tab shouldn't leave orphaned queued work or a stuck queue.
        claudeAgent.stop(client);
    },
};
