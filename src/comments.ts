import { lockHighlightOn, unlockHighlight, getSourceLocation, type SourceLocation } from './inspector.js'
import { ARROW_SVG } from './icons.js'

const TAG = 'kapi-comments'
const STORAGE_KEY = `kapi-comments:${location.pathname}`
const MARKER_COLOR = '34, 197, 94' // green-500, matches the hover highlight
const MARKER_SIZE = 22
const MARKER_RADIUS = MARKER_SIZE / 2
const PANEL_WIDTH = 240 // shared fixed width for both the composer and the submitted tooltip

const STYLES = `
  :host {
    all: initial;
    color-scheme: dark;
  }

  .kapi-comment {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .kapi-comment-marker {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: ${MARKER_SIZE}px;
    height: ${MARKER_SIZE}px;
    border-radius: 50%;
    background: rgb(${MARKER_COLOR});
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    pointer-events: auto;
    cursor: pointer;
    flex: none;
    user-select: none;
  }

  .kapi-comment-marker-enter {
    animation: kapi-marker-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes kapi-marker-in {
    from {
      transform: scale(0.5);
    }
    to {
      transform: scale(1);
    }
  }

  .kapi-comment-tooltip,
  .kapi-comment-composer {
    display: none;
    position: absolute;
    left: ${MARKER_SIZE + 8}px;
    top: 50%;
    transform: translateY(-50%);
    width: ${PANEL_WIDTH}px;
    box-sizing: border-box;
    border-radius: 12px;
    background: #1e1e1f;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.14),
      0 2px 4px rgba(0, 0, 0, 0.2),
      0 8px 16px rgba(0, 0, 0, 0.2);
    pointer-events: auto;
  }

  .kapi-comment-tooltip {
    flex-direction: column;
    gap: 2px;
    padding: 8px 14px;
    color: #fff;
    font-size: 13px;
    line-height: 1.3;
    white-space: normal;
    overflow-wrap: break-word;
    animation: kapi-tooltip-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes kapi-tooltip-in {
    from {
      opacity: 0;
      transform: translateY(-50%) translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(-50%);
    }
  }

  .kapi-comment.kapi-hovering .kapi-comment-tooltip {
    display: flex;
  }

  .kapi-comment-tooltip-source {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    font-weight: 600;
    color: rgb(${MARKER_COLOR});
  }

  .kapi-comment-composer {
    display: flex;
    flex-direction: column;
    top: 0;
    transform: none;
    animation: kapi-composer-in 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .kapi-comment-composer-input-row {
    padding: 8px 0 4px 14px;
  }

  .kapi-comment-composer-actions {
    display: flex;
    justify-content: flex-end;
    padding: 6px;
  }

  @keyframes kapi-composer-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .kapi-comment-input {
    all: unset;
    box-sizing: border-box;
    display: block;
    width: 100%;
    max-height: 120px;
    overflow-y: auto;
    resize: none;
    color: #fff;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.3;
    padding: 0;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
  }

  .kapi-comment-input::-webkit-scrollbar {
    width: 4px;
  }

  .kapi-comment-input::-webkit-scrollbar-track {
    background: transparent;
  }

  .kapi-comment-input::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 999px;
  }

  .kapi-comment-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .kapi-comment-send {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 24px;
    height: 24px;
    border-radius: 8px;
    background: #fff;
    cursor: pointer;
    flex: none;
  }
`

interface CommentEntry {
  id: number
  el: Element
  ratioX: number
  ratioY: number
  text: string
  source: SourceLocation | null
}

interface Draft {
  el: Element
  ratioX: number
  ratioY: number
  // Set when editing an existing comment rather than creating a new one.
  id?: number
  text?: string
}

interface StoredComment {
  id: number
  selector: string
  ratioX: number
  ratioY: number
  text: string
  source: SourceLocation | null
}

let root: ShadowRoot | null = null
let comments: CommentEntry[] = []
let draft: Draft | null = null

// Builds a positional selector (nth-child chain from <body>) so a comment's
// element can be re-found across page reloads without relying on id/class.
function buildUniqueSelector(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el

  while (node && node !== document.body) {
    const parentEl: Element | null = node.parentElement
    if (!parentEl) break

    const index = Array.from(parentEl.children).indexOf(node) + 1
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`)
    node = parentEl
  }

  parts.unshift('body')
  return parts.join(' > ')
}

function saveToStorage() {
  const data: StoredComment[] = comments.map((c) => ({
    id: c.id,
    selector: buildUniqueSelector(c.el),
    ratioX: c.ratioX,
    ratioY: c.ratioY,
    text: c.text,
    source: c.source,
  }))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* ignore (storage disabled/full) */
  }
}

function loadFromStorage() {
  let data: StoredComment[]
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    data = JSON.parse(raw)
  } catch {
    return // ignore corrupt/inaccessible storage
  }

  for (const item of data) {
    const el = document.querySelector(item.selector)
    if (!el) continue // page structure changed since this was saved; skip it
    comments.push({ id: item.id, el, ratioX: item.ratioX, ratioY: item.ratioY, text: item.text, source: item.source })
  }
}

function ensureRoot(): ShadowRoot {
  if (root) return root

  const host = document.createElement(TAG)
  root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLES
  root.appendChild(style)
  document.body.appendChild(host)
  return root
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function position(target: { el: Element; ratioX: number; ratioY: number }, wrapper: HTMLElement) {
  const rect = target.el.getBoundingClientRect()
  const x = rect.left + target.ratioX * rect.width
  const y = rect.top + target.ratioY * rect.height
  wrapper.style.transform = `translate(${x - MARKER_RADIUS}px, ${y - MARKER_RADIUS}px)`
}

function renderMarker(entry: CommentEntry): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'kapi-comment'

  const marker = document.createElement('div')
  marker.className = 'kapi-comment-marker'
  marker.textContent = String(entry.id)

  const tooltip = document.createElement('div')
  tooltip.className = 'kapi-comment-tooltip'

  if (entry.source) {
    const sourceEl = document.createElement('div')
    sourceEl.className = 'kapi-comment-tooltip-source'
    sourceEl.textContent = `${entry.source.file}:${entry.source.line}:${entry.source.column}`
    tooltip.appendChild(sourceEl)
  }

  const textEl = document.createElement('div')
  textEl.textContent = entry.text
  tooltip.appendChild(textEl)

  marker.addEventListener('mouseenter', () => wrapper.classList.add('kapi-hovering'))
  marker.addEventListener('mouseleave', () => wrapper.classList.remove('kapi-hovering'))
  marker.addEventListener('click', () => beginEdit(entry))

  wrapper.append(marker, tooltip)
  position(entry, wrapper)
  return wrapper
}

function renderComposer(
  number: number,
  target: { el: Element; ratioX: number; ratioY: number },
  initialText = '',
): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'kapi-comment'

  const marker = document.createElement('div')
  marker.className = 'kapi-comment-marker kapi-comment-marker-enter'
  marker.textContent = String(number)

  const composer = document.createElement('div')
  composer.className = 'kapi-comment-composer'

  const input = document.createElement('textarea')
  input.className = 'kapi-comment-input'
  input.placeholder = 'Add a comment'
  input.rows = 1
  input.value = initialText

  const autoGrow = () => {
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }
  input.addEventListener('input', autoGrow)

  const sendBtn = document.createElement('button')
  sendBtn.type = 'button'
  sendBtn.className = 'kapi-comment-send'
  sendBtn.setAttribute('aria-label', 'Submit comment')
  sendBtn.innerHTML = ARROW_SVG

  const submit = () => submitDraft(input.value)
  sendBtn.addEventListener('click', submit)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') cancelDraft()
  })

  const inputRow = document.createElement('div')
  inputRow.className = 'kapi-comment-composer-input-row'
  inputRow.appendChild(input)

  const actionsRow = document.createElement('div')
  actionsRow.className = 'kapi-comment-composer-actions'
  actionsRow.appendChild(sendBtn)

  composer.append(inputRow, actionsRow)
  wrapper.append(marker, composer)
  position(target, wrapper)
  queueMicrotask(() => {
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
    autoGrow()
    // Lock the composer's vertical position to its initial (single-line) height,
    // centered on the marker, so later growth only extends it downward instead
    // of continuously re-centering (which would grow it upward too).
    composer.style.top = `${MARKER_RADIUS - composer.getBoundingClientRect().height / 2}px`
  })
  return wrapper
}

function render() {
  const r = ensureRoot()
  r.querySelectorAll('.kapi-comment').forEach((n) => n.remove())

  for (const entry of comments) {
    if (draft && draft.id === entry.id) {
      r.appendChild(renderComposer(entry.id, draft, draft.text))
      continue
    }
    r.appendChild(renderMarker(entry))
  }

  if (draft && draft.id === undefined) {
    r.appendChild(renderComposer(comments.length + 1, draft))
  }
}

function repositionAll() {
  if (!root) return
  const wrappers = root.querySelectorAll<HTMLElement>('.kapi-comment')
  const targets: { el: Element; ratioX: number; ratioY: number }[] = [...comments]
  if (draft) targets.push(draft)
  wrappers.forEach((wrapper, i) => {
    const target = targets[i]
    if (target) position(target, wrapper)
  })
}

window.addEventListener('resize', repositionAll)
window.addEventListener('scroll', repositionAll, true)

document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && draft) cancelDraft()
  },
  true,
)

function submitDraft(rawText: string) {
  if (!draft) return
  const text = rawText.trim()
  if (!text) {
    cancelDraft()
    return
  }

  if (draft.id !== undefined) {
    const entry = comments.find((c) => c.id === draft!.id)
    if (entry) entry.text = text
  } else {
    comments.push({
      id: comments.length + 1,
      el: draft.el,
      ratioX: draft.ratioX,
      ratioY: draft.ratioY,
      text,
      source: getSourceLocation(draft.el),
    })
  }

  draft = null
  unlockHighlight()
  saveToStorage()
  render()
}

function cancelDraft() {
  draft = null
  unlockHighlight()
  render()
}

export function cancelOpenDraft() {
  if (draft) cancelDraft()
}

export function buildCommentsPrompt(): string | null {
  if (comments.length === 0) return null

  const lines = comments.map((c) => {
    const location = c.source ? `${c.source.file}:${c.source.line}:${c.source.column}` : buildUniqueSelector(c.el)
    return `${c.id}. [${location}] ${c.text}`
  })

  return [
    'Address each of the following review comments left on specific elements in this app:',
    '',
    ...lines,
  ].join('\n')
}

export function clearAllComments() {
  comments = []
  if (draft) {
    draft = null
    unlockHighlight()
  }
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore (storage disabled) */
  }
  render()
}

export function beginComment(el: Element, clientX: number, clientY: number) {
  if (draft) return // a draft is already open; must be sent (or Escaped) before starting another

  const rect = el.getBoundingClientRect()
  const ratioX = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0.5
  const ratioY = rect.height > 0 ? clamp((clientY - rect.top) / rect.height, 0, 1) : 0.5

  draft = { el, ratioX, ratioY }
  lockHighlightOn(el)
  render()
}

function beginEdit(entry: CommentEntry) {
  if (draft) return // a draft is already open; must be sent (or Escaped) before starting another

  draft = { el: entry.el, ratioX: entry.ratioX, ratioY: entry.ratioY, id: entry.id, text: entry.text }
  lockHighlightOn(entry.el)
  render()
}

loadFromStorage()
render()
