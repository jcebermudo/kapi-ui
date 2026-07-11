let socket = null;
let onCommentsDone = null;
let onCommentsProcessing = null;
export function connectSocket() {
    const port = window.__KAPI_PORT__ || 6767;
    socket = new WebSocket(`ws://localhost:${port}`);
    socket.addEventListener('open', () => console.log('[kapi] connected to kapi server'));
    socket.addEventListener('close', () => console.log('[kapi] disconnected from kapi server'));
    socket.addEventListener('error', (e) => console.error('[kapi] websocket error', e));
    socket.addEventListener('message', (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'comments:done')
                onCommentsDone?.();
            if (msg.type === 'comments:processing')
                onCommentsProcessing?.(msg.status);
        }
        catch {
            /* ignore malformed messages */
        }
    });
    return socket;
}
export function sendComments(prompt) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        console.error('[kapi] cannot send comments: socket not connected');
        return;
    }
    socket.send(JSON.stringify({ type: 'comments:submit', prompt }));
}
export function setOnCommentsDone(callback) {
    onCommentsDone = callback;
}
export function setOnCommentsProcessing(callback) {
    onCommentsProcessing = callback;
}
