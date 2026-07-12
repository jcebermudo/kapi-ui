import http from "http";
import { spawn, type ChildProcess } from "child_process";
import { WebSocketServer, WebSocket } from "ws";

let sessionId: string | null = null;
let portPromise: Promise<number> | null = null;
let serverStarted = false;

// One persistent Claude process serves all connections (they share one session
// anyway). Kept warm across submissions: no CLI cold-start, no session resume
// from disk, prompt cache stays hot between comments.
let claudeProc: ChildProcess | null = null;
let activeSocket: WebSocket | null = null;
const pendingPrompts: Array<{ prompt: string; socket: WebSocket }> = [];

export function getSessionId() {
  return sessionId;
}

const KAPI_SESSION_PROMPT =
  "You're applying UI edits from visual comments. Each comment gives the exact file:line:col — go straight there, don't search for it. Make only the requested edit. Stay terse: no narration between tool calls, and finish with at most one short sentence.";

function send(socket: WebSocket, msg: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function describeToolUse(name: string, input: any): string {
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

function describeStreamEvent(event: any): string | null {
  if (event.type !== "assistant" || !event.message?.content) return null;
  for (const block of event.message.content) {
    if (block.type === "tool_use") return describeToolUse(block.name, block.input);
    if (block.type === "text" && block.text) return block.text.slice(0, 120);
    // Thinking content isn't exposed by the API (comes back redacted/empty),
    // but the block itself still arrives — surface it so "Starting..." doesn't
    // sit frozen for the several seconds Claude spends reasoning before its
    // first visible tool call.
    if (block.type === "thinking") return "Thinking...";
  }
  return null;
}

function ensureClaudeProc(): ChildProcess | null {
  if (claudeProc && claudeProc.exitCode === null) return claudeProc;

  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Read,Edit,Write",
    "--append-system-prompt", KAPI_SESSION_PROMPT,
  ];
  if (sessionId) args.push("--resume", sessionId);

  let claude: ChildProcess;
  try {
    claude = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    console.error("[kapi] failed to spawn claude:", err);
    return null;
  }
  claudeProc = claude;

  let buffer = "";
  claude.stdout!.on("data", (chunk) => {
    buffer += chunk.toString();
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (event.session_id) sessionId = event.session_id;

      if (event.type === "result") {
        // Turn finished — notify the submitter and start the next queued batch.
        finishActiveTurn();
        continue;
      }

      const status = describeStreamEvent(event);
      if (status && activeSocket) {
        send(activeSocket, { type: "comments:processing", status });
      }
    }
  });
  claude.stderr!.pipe(process.stderr);

  claude.on("error", (err) => {
    console.error("[kapi] claude process error:", err);
  });
  // Writes to stdin can outrace process teardown (e.g. right after a kill()
  // from stopComments); without this listener that throws an uncaught EPIPE.
  claude.stdin!.on("error", (err) => {
    console.error("[kapi] claude stdin error:", err);
  });
  claude.on("close", () => {
    if (claudeProc === claude) claudeProc = null;
    // A queued batch (or the killed-and-stopped one's successors) respawns
    // the process, resuming the same session via --resume.
    finishActiveTurn();
  });

  console.log(`[kapi] claude process started${sessionId ? ` (resuming ${sessionId})` : ""}`);
  return claude;
}

function finishActiveTurn() {
  if (activeSocket) {
    send(activeSocket, { type: "comments:done" });
    activeSocket = null;
  }
  processQueue();
}

function processQueue() {
  if (activeSocket || pendingPrompts.length === 0) return;

  const claude = ensureClaudeProc();
  if (!claude || !claude.stdin) {
    console.error("[kapi] cannot process comments: claude process unavailable");
    // Nothing will retry this later, so drain the whole backlog now rather
    // than stranding everything behind the first failed prompt.
    const stranded = pendingPrompts.splice(0, pendingPrompts.length);
    for (const { socket } of stranded) send(socket, { type: "comments:done" });
    return;
  }

  const next = pendingPrompts.shift()!;
  activeSocket = next.socket;
  send(next.socket, { type: "comments:processing", status: "Starting..." });
  try {
    claude.stdin.write(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: next.prompt }] },
      }) + "\n",
    );
  } catch (err) {
    console.error("[kapi] failed to write prompt to claude stdin:", err);
    finishActiveTurn();
  }
}

function processComments(prompt: string, socket: WebSocket) {
  pendingPrompts.push({ prompt, socket });
  processQueue();
}

function stopComments(socket: WebSocket) {
  // Drop anything this socket queued but hasn't started.
  for (let i = pendingPrompts.length - 1; i >= 0; i--) {
    if (pendingPrompts[i].socket === socket) pendingPrompts.splice(i, 1);
  }
  if (activeSocket === socket && claudeProc) {
    console.log("[kapi] stopping claude process");
    claudeProc.kill();
    // close handler sends comments:done, clears activeSocket, and the next
    // submission respawns with --resume so the session continues.
  }
}

function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const server = http.createServer();

      server.once("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.log(`[kapi] Port ${port} in use, trying ${port + 1}`);
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });

      server.once("listening", () => {
        server.close();
        resolve(port);
      });

      server.listen(port, "localhost");
    };

    tryPort(startPort);
  });
}

export function startServer(portNumber: number): Promise<number> {
  if (serverStarted) return portPromise!;
  serverStarted = true;

  portPromise = (async () => {
    const actualPort = await findAvailablePort(portNumber);

    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("I love capybaras");
    });

    server.listen(actualPort, "localhost", () => {
      console.log(`[kapi] Server running at http://localhost:${actualPort}`);
    });

    const wss = new WebSocketServer({ server });
    wss.on("connection", (socket) => {
      console.log("[kapi] overlay connected via websocket");
      socket.on("close", () => {
        console.log("[kapi] overlay disconnected");
        // Drop this socket's queued prompts and stop its in-flight turn (if
        // any) so a closed tab doesn't leave orphaned work or a stuck queue.
        stopComments(socket);
      });
      socket.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "comments:submit") processComments(msg.prompt, socket);
          else if (msg.type === "comments:stop") stopComments(socket);
        } catch {
          /* ignore malformed messages */
        }
      });
    });

    // Warm the Claude process at startup so the first comment is fast too.
    ensureClaudeProc();

    return actualPort;
  })();

  return portPromise;
}
