import http from 'http';
import { WebSocketServer } from 'ws';
import { claudeAgent } from './claude-agent.js';
import { codexAgent } from './codex-agent.js';
let portPromise = null;
let serverStarted = false;
function findAvailablePort(startPort) {
    return new Promise((resolve, reject) => {
        const tryPort = (port) => {
            const server = http.createServer();
            server.once('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    console.log(`[kapi] Port ${port} in use, trying ${port + 1}`);
                    tryPort(port + 1);
                }
                else {
                    reject(err);
                }
            });
            server.once('listening', () => {
                server.close();
                resolve(port);
            });
            server.listen(port, 'localhost');
        };
        tryPort(startPort);
    });
}
export function startServer(portNumber, options = {}) {
    if (serverStarted)
        return portPromise;
    serverStarted = true;
    const agent = options.agent ?? 'claude';
    const agentRuntime = agent === 'claude' ? claudeAgent : codexAgent;
    const cwd = process.cwd();
    portPromise = (async () => {
        const actualPort = await findAvailablePort(portNumber);
        const server = http.createServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('I love capybaras');
        });
        server.listen(actualPort, 'localhost', () => {
            console.log(`[kapi] Server running at http://localhost:${actualPort} (${agent})`);
        });
        const wss = new WebSocketServer({ server });
        wss.on('connection', (socket) => {
            console.log('[kapi] overlay connected via websocket');
            socket.on('close', () => {
                console.log('[kapi] overlay disconnected');
                agentRuntime.onClose(socket);
            });
            socket.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.type === 'comments:submit')
                        agentRuntime.submit(message.prompt, socket, cwd);
                    if (message.type === 'comments:stop')
                        agentRuntime.stop(socket);
                }
                catch {
                    /* ignore malformed messages */
                }
            });
        });
        agentRuntime.start(cwd);
        return actualPort;
    })();
    return portPromise;
}
