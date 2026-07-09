import http from "http";
import { spawn } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
let sessionId = null;
export function getSessionId() {
    return sessionId;
}
const KAPI_SESSION_PROMPT = "This session is dedicated to giving you commands on what to edit in the codebase, with specific file locations and specs, so give precise, actionable details.";
function startClaudeSession() {
    const claude = spawn("claude", ["-p", KAPI_SESSION_PROMPT, "--output-format", "json"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    claude.stdout.on("data", (chunk) => {
        stdout += chunk;
    });
    claude.stderr.pipe(process.stderr);
    claude.on("close", () => {
        try {
            const result = JSON.parse(stdout);
            sessionId = result.session_id;
            console.log(`Claude session started: ${sessionId}`);
        }
        catch (err) {
            console.error("Failed to parse claude -p output:", err);
        }
    });
}
function send(socket, msg) {
    if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(msg));
}
function describeToolUse(name, input) {
    switch (name) {
        case "Read":
            return `Reading ${input?.file_path ?? "a file"}`;
        case "Edit":
        case "Write":
            return `Editing ${input?.file_path ?? "a file"}`;
        case "Bash":
            return `Running: ${String(input?.command ?? "").slice(0, 60)}`;
        case "Grep":
            return `Searching for "${input?.pattern ?? ""}"`;
        case "Glob":
            return `Finding files matching ${input?.pattern ?? ""}`;
        default:
            return `Using ${name}`;
    }
}
function describeStreamEvent(event) {
    if (event.type !== "assistant" || !event.message?.content)
        return null;
    for (const block of event.message.content) {
        if (block.type === "tool_use")
            return describeToolUse(block.name, block.input);
        if (block.type === "text" && block.text)
            return block.text.slice(0, 120);
    }
    return null;
}
function processComments(prompt, socket) {
    if (!sessionId) {
        console.error("[kapi] cannot process comments: no active claude session");
        return;
    }
    send(socket, { type: "comments:processing", status: "Starting..." });
    const claude = spawn("claude", ["-p", "--resume", sessionId, "--permission-mode", "auto", prompt, "--output-format", "stream-json", "--verbose"], { stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "";
    claude.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
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
            if (event.type === "result" && event.session_id)
                sessionId = event.session_id;
            const status = describeStreamEvent(event);
            if (status)
                send(socket, { type: "comments:processing", status });
        }
    });
    claude.stderr.pipe(process.stderr);
    claude.on("close", () => {
        send(socket, { type: "comments:done" });
    });
}
export function startServer(portNumber) {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("I love capybaras");
    });
    server.listen(portNumber, "localhost", () => {
        console.log(`Server running at http://localhost:${portNumber}`);
    });
    const wss = new WebSocketServer({ server });
    wss.on("connection", (socket) => {
        console.log("[kapi] overlay connected via websocket");
        socket.on("close", () => console.log("[kapi] overlay disconnected"));
        socket.on("message", (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === "comments:submit")
                    processComments(msg.prompt, socket);
            }
            catch {
                /* ignore malformed messages */
            }
        });
    });
    startClaudeSession();
}
