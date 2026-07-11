const HIGHLIGHT_COLOR = '34, 197, 94' // green-500, as an rgb triplet for reuse in rgba()
const IGNORE_SELECTOR = 'kapi-overlay, kapi-hover-panel, kapi-comments'

let highlightEl: HTMLDivElement | null = null
let blockerEl: HTMLDivElement | null = null
let hoveredEl: Element | null = null
let active = false
let locked = false
let disabled = false
let onHover: ((el: Element | null) => void) | null = null
let onElementClick: ((el: Element, clientX: number, clientY: number) => void) | null = null

function ensureHighlightEl(): HTMLDivElement {
  if (highlightEl) return highlightEl

  const el = document.createElement('div')
  el.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    pointer-events: none;
    box-sizing: border-box;
    background: rgba(${HIGHLIGHT_COLOR}, 0.2);
    border: 1px solid rgb(${HIGHLIGHT_COLOR});
    z-index: 2147483646;
    display: none;
    transition: transform 120ms ease, width 120ms ease, height 120ms ease;
  `
  document.body.appendChild(el)
  highlightEl = el
  return el
}

function handleBlockerClick(e: MouseEvent) {
  const stack = document.elementsFromPoint(e.clientX, e.clientY)
  if (stack[0]?.closest(IGNORE_SELECTOR)) return
  const el = stack.find(isInspectable) ?? null
  if (!el) return
  onElementClick?.(el, e.clientX, e.clientY)
}

function ensureBlockerEl(): HTMLDivElement {
  if (blockerEl) return blockerEl

  const el = document.createElement('div')
  el.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: auto;
    background: transparent;
    z-index: 2147483645;
    display: none;
  `
  el.addEventListener('click', handleBlockerClick)
  document.body.appendChild(el)
  blockerEl = el
  return el
}

function isInspectable(el: Element | null): el is Element {
  if (!el) return false
  if (el === blockerEl) return false
  if (el.closest(IGNORE_SELECTOR)) return false
  return true
}

function buildSelectorPath(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el

  while (node && node !== document.body && node !== document.documentElement) {
    let part = node.tagName.toLowerCase()
    if (node.id) part += `#${node.id}`
    else if (node.classList.length > 0) part += `.${node.classList[0]}`
    parts.unshift(part)
    node = node.parentElement
  }

  return parts.join(' > ') || el.tagName.toLowerCase()
}

export interface SourceLocation {
  file: string
  line: number
  column: number
}

export function getSourceLocation(el: Element): SourceLocation | null {
  const host = el.closest('[data-kapi-loc]')
  if (!host) return null

  const raw = host.getAttribute('data-kapi-loc')!
  const lastColon = raw.lastIndexOf(':')
  const secondLastColon = raw.lastIndexOf(':', lastColon - 1)
  if (lastColon === -1 || secondLastColon === -1) return null

  return {
    file: raw.slice(0, secondLastColon),
    line: Number(raw.slice(secondLastColon + 1, lastColon)),
    column: Number(raw.slice(lastColon + 1)),
  }
}

export interface ComponentInfo {
  name: string
  file: string | null
}

// Vue's renderer stamps every DOM node it creates with a non-enumerable
// `__vueParentComponent` pointing at the component instance whose render()
// produced it, so this reads straight off the element instead of walking the
// DOM for a compile-time attribute. `type.__file` is populated by
// @vitejs/plugin-vue in dev builds for devtools, at no extra cost to us.
interface VueComponentInstance {
  type: { name?: string; __name?: string; __file?: string }
}

let warnedMissingComponentInfo = false

export function getComponentInfo(el: Element): ComponentInfo | null {
  const instance = (el as Element & { __vueParentComponent?: VueComponentInstance }).__vueParentComponent

  if (!instance) {
    // `data-kapi-loc` is stamped at build time onto real Vue template
    // elements (see location-transform.ts), independently of this runtime
    // property. If it's present but `__vueParentComponent` isn't, that's not
    // "this element isn't Vue-managed" (the normal, silent null case) — it's
    // a sign Vue renamed/removed this internal property, so warn once rather
    // than degrading silently everywhere.
    if (!warnedMissingComponentInfo && el.closest('[data-kapi-loc]')) {
      warnedMissingComponentInfo = true
      console.warn(
        '[kapi] Could not resolve Vue component info for an element with a known source location. ' +
          "Vue's internal `__vueParentComponent` property may have changed in this Vue version — " +
          'component names/files will be unavailable until kapi is updated to match.',
      )
    }
    return null
  }

  const name = instance.type.name || instance.type.__name
  if (!name) return null

  return { name, file: instance.type.__file ?? null }
}

// Shared by the hover panel and comment tooltips, which both render a
// `<ComponentName>` badge but style it with their own class.
export function renderComponentBadge(component: ComponentInfo, className: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className
  el.textContent = `<${component.name}>`
  return el
}

export interface ElementLocation {
  tag: string
  id: string | null
  classes: string[]
  selector: string
  source: SourceLocation | null
  component: ComponentInfo | null
}

export function describeElement(el: Element): ElementLocation {
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: [...el.classList],
    selector: buildSelectorPath(el),
    source: getSourceLocation(el),
    component: getComponentInfo(el),
  }
}

function paintHighlight(el: Element) {
  const box = ensureHighlightEl()
  const rect = el.getBoundingClientRect()
  box.style.display = 'block'
  box.style.transform = `translate(${rect.left}px, ${rect.top}px)`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
}

function clearHighlight() {
  if (highlightEl) highlightEl.style.display = 'none'
  hoveredEl = null
  onHover?.(null)
}

function handlePointerMove(e: PointerEvent) {
  if (locked) return

  const stack = document.elementsFromPoint(e.clientX, e.clientY)

  // The overlay/hover-panel/comments UI sits above the blocker in z-index, so
  // when the cursor is directly over it, it's the topmost hit. Bail out here
  // rather than falling through to stack.find, which would otherwise select
  // whatever page element happens to sit behind our own UI.
  if (stack[0]?.closest(IGNORE_SELECTOR)) {
    clearHighlight()
    return
  }

  const el = stack.find(isInspectable) ?? null
  if (!el) {
    clearHighlight()
    return
  }
  if (el === hoveredEl) return
  hoveredEl = el
  paintHighlight(el)
  onHover?.(el)
}

export function setOnHover(callback: (el: Element | null) => void) {
  onHover = callback
}

export function lockHighlightOn(el: Element) {
  locked = true
  hoveredEl = el
  paintHighlight(el)
  onHover?.(el)
}

export function unlockHighlight() {
  locked = false
}

export function setOnElementClick(callback: (el: Element, clientX: number, clientY: number) => void) {
  onElementClick = callback
}

export function startInspecting() {
  if (active || disabled) return
  active = true
  document.addEventListener('pointermove', handlePointerMove, true)
  ensureBlockerEl().style.display = 'block'
}

export function stopInspecting() {
  if (!active) return
  active = false
  document.removeEventListener('pointermove', handlePointerMove, true)
  clearHighlight()
  if (blockerEl) blockerEl.style.display = 'none'
}

// Forcibly disables inspecting regardless of the bar's expand/collapse state,
// and blocks it from being re-enabled until re-allowed (e.g. while Claude is
// processing submitted comments).
export function setDisabled(value: boolean) {
  disabled = value
  if (disabled) stopInspecting()
}
