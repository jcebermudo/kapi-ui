const HIGHLIGHT_COLOR = '34, 197, 94'; // green-500, as an rgb triplet for reuse in rgba()
const IGNORE_SELECTOR = 'kapi-overlay, kapi-hover-panel, kapi-comments';
let highlightEl = null;
let blockerEl = null;
let hoveredEl = null;
let active = false;
let locked = false;
let disabled = false;
let onHover = null;
let onElementClick = null;
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
    border: 2px solid rgb(${HIGHLIGHT_COLOR});
    z-index: 2147483646;
    display: none;
  `;
    document.body.appendChild(el);
    highlightEl = el;
    return el;
}
function handleBlockerClick(e) {
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    const el = stack.find(isInspectable) ?? null;
    if (!el)
        return;
    onElementClick?.(el, e.clientX, e.clientY);
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
export function getSourceLocation(el) {
    const host = el.closest('[data-kapi-loc]');
    if (!host)
        return null;
    const raw = host.getAttribute('data-kapi-loc');
    const lastColon = raw.lastIndexOf(':');
    const secondLastColon = raw.lastIndexOf(':', lastColon - 1);
    if (lastColon === -1 || secondLastColon === -1)
        return null;
    return {
        file: raw.slice(0, secondLastColon),
        line: Number(raw.slice(secondLastColon + 1, lastColon)),
        column: Number(raw.slice(lastColon + 1)),
    };
}
export function describeElement(el) {
    return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: [...el.classList],
        selector: buildSelectorPath(el),
        source: getSourceLocation(el),
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
    if (locked)
        return;
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
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
    onHover?.(el);
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
