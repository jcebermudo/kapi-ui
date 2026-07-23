// Minimal typing for the subset of Vite's HMR client API kapi uses to talk to
// the dev server (see socket.ts). We ride Vite's existing HMR websocket via
// custom events instead of running our own server, so there's no port to
// discover. Declared locally rather than referencing `vite/client` to avoid
// pulling in all of its ambient module declarations.
interface ImportMeta {
  readonly hot?: {
    send(event: string, data?: unknown): void
    on(event: string, cb: (data: any) => void): void
  }
}
