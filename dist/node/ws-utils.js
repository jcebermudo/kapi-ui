import { WebSocket } from 'ws';
export function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(message));
}
