import { findTraceFromElement } from './trace-record.js';
const HIGHLIGHT_COLOR = '34, 197, 94'; // green-500, as an rgb triplet for reuse in rgba()
const SELECTION_COLOR = '34, 197, 94'; // green-500, matches single-select highlight; for multi-select outlines/marquee
const IGNORE_SELECTOR = 'kapi-overlay, kapi-hover-panel, kapi-comments';
const DRAG_THRESHOLD = 4;
const BOX_SELECT_STEP = 16; // px between elementsFromPoint samples inside a drag box
let highlightEl = null;
let blockerEl = null;
let hoveredEl = null;
let active = false;
let locked = false;
let disabled = false;
let onHover = null;
let onElementClick = null;
// Multi-select state: shift-click toggles individual elements, drag draws a
// marquee and adds every element sampled inside it. Both feed the same Set;
// every change is pushed out immediately so the caller can keep a composer
// live while the selection grows. A plain click clears it.
const selected = new Set();
let onSelectionChange = null;
// Blue outline boxes, shared by two callers: the live selection above, and
// beginEdit() in comments.ts previewing an existing multi-target comment's
// elements. Whichever last wrote `outlineTargets` wins the paint.
let outlineTargets = [];
let selectionOutlineEls = [];
let marqueeEl = null;
let boxDragStart = null;
let boxDragging = false;
let justBoxSelected = false; // swallows the click that follows a drag-release
function ensureMarqueeEl() {
    if (marqueeEl)
        return marqueeEl;
    const el = document.createElement('div');
    el.style.cssText = `
    position: fixed;
    pointer-events: none;
    box-sizing: border-box;
    background: rgba(${SELECTION_COLOR}, 0.1);
    border: 1px solid rgb(${SELECTION_COLOR});
    z-index: 2147483646;
    display: none;
  `;
    document.body.appendChild(el);
    marqueeEl = el;
    return el;
}
function paintMarquee(x1, y1, x2, y2) {
    const box = ensureMarqueeEl();
    box.style.display = 'block';
    box.style.left = `${Math.min(x1, x2)}px`;
    box.style.top = `${Math.min(y1, y2)}px`;
    box.style.width = `${Math.abs(x2 - x1)}px`;
    box.style.height = `${Math.abs(y2 - y1)}px`;
}
function hideMarquee() {
    if (marqueeEl)
        marqueeEl.style.display = 'none';
}
function paintOutlines() {
    selectionOutlineEls.forEach((el) => el.remove());
    selectionOutlineEls = outlineTargets.map((el) => {
        const box = document.createElement('div');
        const rect = el.getBoundingClientRect();
        box.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      pointer-events: none;
      box-sizing: border-box;
      background: rgba(${SELECTION_COLOR}, 0.15);
      border: 1px solid rgb(${SELECTION_COLOR});
      z-index: 2147483646;
      transform: translate(${rect.left}px, ${rect.top}px);
      width: ${rect.width}px;
      height: ${rect.height}px;
    `;
        document.body.appendChild(box);
        return box;
    });
}
function repositionOutlines() {
    if (outlineTargets.length > 0)
        paintOutlines();
}
window.addEventListener('resize', repositionOutlines);
window.addEventListener('scroll', repositionOutlines, true);
export function setOnSelectionChange(callback) {
    onSelectionChange = callback;
}
function notifySelectionChange() {
    outlineTargets = [...selected];
    paintOutlines();
    onSelectionChange?.([...selected]);
}
// Shows blue outlines on an arbitrary set of elements without touching the
// interactive `selected` Set above — used to preview an existing multi-target
// comment's elements while it's being edited.
export function previewElements(els) {
    outlineTargets = els;
    paintOutlines();
}
export function clearPreview() {
    outlineTargets = [];
    paintOutlines();
}
function toggleSelected(el) {
    selected.has(el) ? selected.delete(el) : selected.add(el);
    notifySelectionChange();
}
export function clearSelection() {
    if (selected.size === 0)
        return;
    selected.clear();
    notifySelectionChange();
}
function elementsInBox(x1, y1, x2, y2) {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    const found = new Set();
    for (let y = top; y <= bottom; y += BOX_SELECT_STEP) {
        for (let x = left; x <= right; x += BOX_SELECT_STEP) {
            const stack = document.elementsFromPoint(x, y);
            if (stack[0]?.closest(IGNORE_SELECTOR))
                continue;
            const el = stack.find(isInspectable);
            if (el)
                found.add(el);
        }
    }
    return [...found];
}
function selectElementsInBox(x1, y1, x2, y2, additive) {
    if (!additive)
        selected.clear();
    for (const el of elementsInBox(x1, y1, x2, y2))
        selected.add(el);
    notifySelectionChange();
}
function handleBlockerPointerDown(e) {
    if (e.button !== 0)
        return;
    boxDragStart = { x: e.clientX, y: e.clientY };
    boxDragging = false;
    // Leave the hover highlight up during the press: a plain click keeps it lit
    // straight through to lockHighlightOn (no flicker), and a real drag-select
    // clears it once the drag threshold is crossed (see handleBlockerPointerMove).
    blockerEl?.setPointerCapture(e.pointerId);
}
function handleBlockerPointerMove(e) {
    if (!boxDragStart)
        return;
    const dx = e.clientX - boxDragStart.x;
    const dy = e.clientY - boxDragStart.y;
    if (!boxDragging) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD)
            return;
        boxDragging = true;
        clearHighlight(); // hide the hover box so it doesn't fight the marquee
    }
    paintMarquee(boxDragStart.x, boxDragStart.y, e.clientX, e.clientY);
    // Live-preview every element the box currently touches (union with the
    // existing selection when additive), so the user sees what they're grabbing
    // before releasing. Committed to `selected` only on pointer-up.
    const touched = elementsInBox(boxDragStart.x, boxDragStart.y, e.clientX, e.clientY);
    previewElements(e.shiftKey ? [...new Set([...selected, ...touched])] : touched);
}
function handleBlockerPointerUp(e) {
    if (!boxDragStart)
        return;
    if (boxDragging) {
        selectElementsInBox(boxDragStart.x, boxDragStart.y, e.clientX, e.clientY, e.shiftKey);
        hideMarquee();
        justBoxSelected = true;
    }
    boxDragStart = null;
    boxDragging = false;
}
function ensureHighlightEl() {
    if (highlightEl)
        return highlightEl;
    const el = document.createElement('div');
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
  `;
    document.body.appendChild(el);
    highlightEl = el;
    return el;
}
function handleBlockerClick(e) {
    if (justBoxSelected) {
        justBoxSelected = false;
        return; // this click is the tail end of a drag-select release, not a real click
    }
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    if (stack[0]?.closest(IGNORE_SELECTOR))
        return;
    const el = stack.find(isInspectable) ?? null;
    if (!el)
        return;
    if (e.shiftKey) {
        toggleSelected(el);
        return;
    }
    if (selected.size > 0) {
        clearSelection();
        return;
    }
    onElementClick?.(el, e.clientX, e.clientY);
}
export function isBoxSelectClick() {
    return justBoxSelected;
}
function ensureBlockerEl() {
    if (blockerEl)
        return blockerEl;
    const el = document.createElement('div');
    el.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: auto;
    background: transparent;
    z-index: 2147483645;
    display: none;
  `;
    el.addEventListener('click', handleBlockerClick);
    el.addEventListener('pointerdown', handleBlockerPointerDown);
    el.addEventListener('pointermove', handleBlockerPointerMove);
    el.addEventListener('pointerup', handleBlockerPointerUp);
    document.body.appendChild(el);
    blockerEl = el;
    return el;
}
function isInspectable(el) {
    if (!el)
        return false;
    if (el === blockerEl)
        return false;
    if (el.closest(IGNORE_SELECTOR))
        return false;
    return true;
}
function buildSelectorPath(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
        let part = node.tagName.toLowerCase();
        if (node.id)
            part += `#${node.id}`;
        else if (node.classList.length > 0)
            part += `.${node.classList[0]}`;
        parts.unshift(part);
        node = node.parentElement;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
}
// Most elements resolve directly via `el.__vnode` (see trace-record.ts). The
// ancestor walk below exists for the elements that can't: plain text nodes
// (no vnode at all), `_createStaticVNode` content (raw innerHTML — Vue never
// creates individual vnodes for its inner elements), and vnodes Vue cloned
// *with* extra props (`cloneVNode(vnode, extraProps)` builds a fresh `props`
// object via `mergeProps`, breaking the WeakMap identity link — a clone with
// no extraProps reuses the same `props` reference and resolves directly).
// In all of these, the nearest traced ancestor is the best available
// approximation.
export function getSourceLocation(el) {
    let node = el;
    while (node) {
        const trace = findTraceFromElement(node);
        if (trace)
            return trace;
        node = node.parentElement;
    }
    return null;
}
let warnedMissingComponentInfo = false;
export function getComponentInfo(el) {
    const instance = el.__vueParentComponent;
    if (!instance) {
        // `el.__vnode` (see trace-record.ts) is a separate internal Vue
        // back-reference from `__vueParentComponent`. If it's present but
        // `__vueParentComponent` isn't, that's not "this element isn't
        // Vue-managed" (the normal, silent null case) — it's a sign Vue
        // renamed/removed this internal property, so warn once rather than
        // degrading silently everywhere.
        if (!warnedMissingComponentInfo && findTraceFromElement(el)) {
            warnedMissingComponentInfo = true;
            console.warn('[kapi] Could not resolve Vue component info for an element with a known source location. ' +
                "Vue's internal `__vueParentComponent` property may have changed in this Vue version — " +
                'component names/files will be unavailable until kapi is updated to match.');
        }
        return null;
    }
    const name = instance.type.name || instance.type.__name;
    if (!name)
        return null;
    return { name, file: instance.type.__file ?? null };
}
// Shared by the hover panel and comment tooltips, which both render a
// `<ComponentName>` badge but style it with their own class.
export function renderComponentBadge(component, className) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = `<${component.name}>`;
    return el;
}
export function describeElement(el) {
    return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: [...el.classList],
        selector: buildSelectorPath(el),
        source: getSourceLocation(el),
        component: getComponentInfo(el),
    };
}
function paintHighlight(el) {
    const box = ensureHighlightEl();
    const rect = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
}
function clearHighlight() {
    if (highlightEl)
        highlightEl.style.display = 'none';
    hoveredEl = null;
    onHover?.(null);
}
function handlePointerMove(e) {
    // Freeze hover once the pointer is down on the blocker (boxDragStart set):
    // the cursor is committing to a click or a drag-select, not hovering. This
    // also wins the capture-phase race on the drag's first move, where this
    // handler would otherwise repaint the hover box a beat before the blocker's
    // handler clears it.
    if (locked || boxDragging || boxDragStart)
        return;
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    // The overlay/hover-panel/comments UI sits above the blocker in z-index, so
    // when the cursor is directly over it, it's the topmost hit. Bail out here
    // rather than falling through to stack.find, which would otherwise select
    // whatever page element happens to sit behind our own UI.
    if (stack[0]?.closest(IGNORE_SELECTOR)) {
        clearHighlight();
        return;
    }
    const el = stack.find(isInspectable) ?? null;
    if (!el) {
        clearHighlight();
        return;
    }
    if (el === hoveredEl)
        return;
    hoveredEl = el;
    paintHighlight(el);
    onHover?.(el);
}
export function setOnHover(callback) {
    onHover = callback;
}
export function lockHighlightOn(el) {
    locked = true;
    hoveredEl = el;
    paintHighlight(el);
    onHover?.(null);
}
// Freezes hover (like lockHighlightOn) but skips the single green highlight
// box — used while composing on a multi-select batch, where the blue
// selection outlines (see notifySelectionChange) already mark every element
// and a green box on just the anchor would visually clash with them.
export function lockWithoutHighlight() {
    locked = true;
    clearHighlight();
}
export function unlockHighlight() {
    locked = false;
}
export function setOnElementClick(callback) {
    onElementClick = callback;
}
export function startInspecting() {
    if (active || disabled)
        return;
    active = true;
    document.addEventListener('pointermove', handlePointerMove, true);
    ensureBlockerEl().style.display = 'block';
}
export function stopInspecting() {
    if (!active)
        return;
    active = false;
    document.removeEventListener('pointermove', handlePointerMove, true);
    clearHighlight();
    clearSelection();
    if (blockerEl)
        blockerEl.style.display = 'none';
}
// Forcibly disables inspecting regardless of the bar's expand/collapse state,
// and blocks it from being re-enabled until re-allowed (e.g. while Claude is
// processing submitted comments).
export function setDisabled(value) {
    disabled = value;
    if (disabled)
        stopInspecting();
}
export function isDisabled() {
    return disabled;
}
export function clearHighlightIfNotInspecting() {
    if (!active)
        clearHighlight();
}
