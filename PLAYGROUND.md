# Kapi UI Playground

The playground environment lets you test kapi-ui changes in real Vite and Nuxt applications without `npm link`. Changes to the kapi-ui source are compiled via TypeScript watch and automatically available in the playground apps.

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start TypeScript watch (one terminal)
```bash
npm run dev
```

This compiles kapi-ui source changes to `dist/` as you edit. Keep this running.

### 3. Start a playground app (another terminal)

**Vite app:**
```bash
cd ../playground/vite-app
npm run dev
```

**Nuxt app:**
```bash
cd ../playground/nuxt-app
npm run dev
```

Your browser opens automatically. kapi-ui overlay should appear immediately. Test by hovering over elements, creating comments, and sending them to Claude Code.

## How It Works

1. **TypeScript watch** compiles `src/` → `dist/` whenever you edit
2. **Playground apps** import kapi-ui from `dist/` (via path alias in `tsconfig.json`)
3. **Vite/Nuxt dev server** watches the `dist/` folder and hot-reloads when files change
4. **Result:** Your edits appear live in the browser with zero lag

## Testing a Change

Example: You fix a bug in the hover highlighting.

1. Edit `src/browser/inspector.ts` (the file with the bug)
2. Watch terminal shows: `src/browser/inspector.ts: built in 150ms`
3. Browser automatically refreshes — test your fix immediately

## Switching Between Apps

- **Vite app** (simpler, faster): Good for quick iterations
- **Nuxt app** (more complex): Tests Nuxt-specific integration

Test your change in both to ensure it works everywhere.

## Troubleshooting

### Changes aren't appearing in the browser

1. **Confirm tsc is running** — check the watch terminal for compilation output
2. **Check browser console** for WebSocket errors (connection to kapi server may have failed)
3. **Refresh the browser** manually (Cmd+R or Ctrl+R)
4. **Clear `dist/` and restart:**
   ```bash
   rm -rf dist
   npm run dev
   ```

### "kapi-ui not found" error

Confirm the path alias in the playground app's `tsconfig.json` points to the correct location:
```json
{
  "compilerOptions": {
    "paths": {
      "kapi-ui": ["../../packages/kapi-ui/dist"]
    }
  }
}
```

If you're in `/playground/vite-app`, the path should reach `/packages/kapi-ui/dist` (relative to the root).

### Claude Code isn't installed

The kapi server spawns the `claude` CLI to process comments. Install it:
```bash
npm install -g @anthropic-ai/claude-code
```

Then verify: `claude --version`

### Port 6767 is already in use

The kapi server tries to use port 6767, and auto-increments if taken. Check:
- Is another kapi playground running? Kill it: `pkill -f "kapi server"` (or just restart)
- Another app using the port? Free it or kill the app

## What to Test Before Committing

- [ ] Overlay appears and responds to clicks
- [ ] Hovering shows component info (file, selector)
- [ ] Creating a comment works; marker appears
- [ ] Editing/deleting comments works
- [ ] Sending comments to Claude processes without permission prompts
- [ ] **Stop feature** works: logo animates to STOP icon, clicking it kills Claude, comments persist
- [ ] Port auto-increments if 6767 is taken
- [ ] Works in both Vite and Nuxt apps

---

**Need help?** Check the main [CLAUDE.md](./CLAUDE.md) for architectural details and debugging tips.
