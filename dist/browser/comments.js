import { lockHighlightOn, unlockHighlight, clearHighlightIfNotInspecting, getSourceLocation, getComponentInfo, renderComponentBadge, isDisabled, clearSelection, isBoxSelectClick, lockWithoutHighlight, previewElements, clearPreview, } from './inspector.js';
import { ARROW_SVG, DELETE_SVG } from './icons.js';
import STYLES from './styles/comments.css?inline';
const TAG = 'kapi-comments';
const MARKER_SIZE = 22;
const MARKER_RADIUS = MARKER_SIZE / 2;
// Storage key and in-memory comments are scoped to the current page. In an
// SPA, navigating via the router doesn't reload this script, so both are
// re-derived from `location.pathname` on every navigation (see
// watchForNavigation below) rather than fixed once at module load.
let storageKey = `kapi-comments:${location.pathname}`;
let currentPathname = location.pathname;
let root = null;
let comments = [];
let draft = null;
// Builds a positional selector (nth-child chain from <body>) so a comment's
// element can be re-found across page reloads without relying on id/class.
function buildUniqueSelector(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body) {
        const parentEl = node.parentElement;
        if (!parentEl)
            break;
        const index = Array.from(parentEl.children).indexOf(node) + 1;
        parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
        node = parentEl;
    }
    parts.unshift('body');
    return parts.join(' > ');
}
function saveToStorage() {
    const data = comments.map((c) => ({
        id: c.id,
        selector: buildUniqueSelector(c.el),
        ratioX: c.ratioX,
        ratioY: c.ratioY,
        text: c.text,
        source: c.source,
        component: c.component,
        targets: c.targets?.map((t) => ({
            selector: buildUniqueSelector(t.el),
            source: t.source,
            component: t.component,
        })),
    }));
    try {
        localStorage.setItem(storageKey, JSON.stringify(data));
    }
    catch {
        /* ignore (storage disabled/full) */
    }
}
function loadFromStorage() {
    let data;
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw)
            return;
        data = JSON.parse(raw);
    }
    catch {
        return; // ignore corrupt/inaccessible storage
    }
    for (const item of data) {
        const el = document.querySelector(item.selector);
        if (!el)
            continue; // page structure changed since this was saved; skip it
        let targets;
        if (item.targets) {
            targets = item.targets.reduce((acc, t) => {
                const targetEl = document.querySelector(t.selector);
                if (targetEl)
                    acc.push({ el: targetEl, source: t.source, component: t.component });
                return acc;
            }, []);
        }
        comments.push({
            id: item.id,
            el,
            ratioX: item.ratioX,
            ratioY: item.ratioY,
            text: item.text,
            source: item.source,
            component: item.component,
            targets,
        });
    }
}
function ensureRoot() {
    if (root)
        return root;
    const host = document.createElement(TAG);
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    root.appendChild(style);
    document.body.appendChild(host);
    return root;
}
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function position(target, wrapper) {
    const rect = target.el.getBoundingClientRect();
    const x = rect.left + target.ratioX * rect.width;
    const y = rect.top + target.ratioY * rect.height;
    wrapper.style.setProperty('--kapi-x', `${x - MARKER_RADIUS}px`);
    wrapper.style.setProperty('--kapi-y', `${y - MARKER_RADIUS}px`);
}
// Plays the exit animation on a wrapper, then removes it. The node keeps its
// `.kapi-comment` class (so its position vars still apply) but gains
// `.kapi-leaving`, which render()/repositionAll skip — so it animates out
// independently of the fresh nodes render() builds, then self-removes.
function animateOut(node) {
    node.classList.add('kapi-leaving');
    const onEnd = (e) => {
        if (e.target !== node)
            return;
        node.removeEventListener('animationend', onEnd);
        node.remove();
    };
    node.addEventListener('animationend', onEnd);
}
function renderMarker(entry) {
    const wrapper = document.createElement('div');
    wrapper.className = 'kapi-comment';
    const marker = document.createElement('div');
    marker.className = 'kapi-comment-marker';
    marker.textContent = String(entry.id);
    const tooltip = document.createElement('div');
    tooltip.className = 'kapi-comment-tooltip';
    if (entry.component) {
        tooltip.appendChild(renderComponentBadge(entry.component, 'kapi-comment-tooltip-component'));
    }
    if (entry.source) {
        const sourceEl = document.createElement('div');
        sourceEl.className = 'kapi-comment-tooltip-source';
        sourceEl.textContent = `${entry.source.file}:${entry.source.line}:${entry.source.column}`;
        tooltip.appendChild(sourceEl);
    }
    const textEl = document.createElement('div');
    textEl.textContent = entry.text;
    tooltip.appendChild(textEl);
    if (entry.targets && entry.targets.length > 1) {
        const countEl = document.createElement('div');
        countEl.className = 'kapi-comment-tooltip-source';
        countEl.textContent = `applies to ${entry.targets.length} elements`;
        tooltip.appendChild(countEl);
    }
    marker.addEventListener('mouseenter', () => wrapper.classList.add('kapi-hovering'));
    marker.addEventListener('mouseleave', () => wrapper.classList.remove('kapi-hovering'));
    marker.addEventListener('click', () => beginEdit(entry));
    wrapper.append(marker, tooltip);
    position(entry, wrapper);
    return wrapper;
}
function renderComposer(label, target, initialText = '') {
    const wrapper = document.createElement('div');
    wrapper.className = 'kapi-comment';
    const marker = document.createElement('div');
    marker.className = 'kapi-comment-marker kapi-comment-marker-enter';
    marker.textContent = label;
    const composer = document.createElement('div');
    composer.className = 'kapi-comment-composer';
    const input = document.createElement('textarea');
    input.className = 'kapi-comment-input';
    input.placeholder = 'Add a comment';
    input.rows = 1;
    input.value = initialText;
    const autoGrow = () => {
        input.style.height = 'auto';
        input.style.height = `${input.scrollHeight}px`;
    };
    input.addEventListener('input', autoGrow);
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'kapi-comment-send';
    sendBtn.setAttribute('aria-label', 'Submit comment');
    sendBtn.innerHTML = ARROW_SVG;
    const submit = () => submitDraft(input.value);
    sendBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
        if (e.key === 'Escape')
            cancelDraft();
    });
    const inputRow = document.createElement('div');
    inputRow.className = 'kapi-comment-composer-input-row';
    inputRow.appendChild(input);
    const actionsRow = document.createElement('div');
    actionsRow.className = 'kapi-comment-composer-actions';
    if (initialText) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'kapi-comment-delete';
        deleteBtn.setAttribute('aria-label', 'Delete comment');
        deleteBtn.innerHTML = DELETE_SVG;
        deleteBtn.addEventListener('click', () => {
            if (draft?.id)
                deleteComment(draft.id);
        });
        actionsRow.appendChild(deleteBtn);
    }
    actionsRow.appendChild(sendBtn);
    composer.append(inputRow, actionsRow);
    wrapper.append(marker, composer);
    position(target, wrapper);
    queueMicrotask(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        autoGrow();
        // Lock the composer's vertical position to its initial (single-line) height,
        // centered on the marker, so later growth only extends it downward instead
        // of continuously re-centering (which would grow it upward too).
        composer.style.top = `${MARKER_RADIUS - composer.getBoundingClientRect().height / 2}px`;
    });
    return wrapper;
}
function render() {
    const r = ensureRoot();
    r.querySelectorAll('.kapi-comment:not(.kapi-leaving)').forEach((n) => n.remove());
    for (const entry of comments) {
        if (draft && draft.id === entry.id) {
            r.appendChild(renderComposer(String(entry.id), draft, draft.text));
            continue;
        }
        r.appendChild(renderMarker(entry));
    }
    if (draft && draft.id === undefined) {
        const label = draft.els && draft.els.length > 1 ? `${draft.els.length}` : String(comments.length + 1);
        r.appendChild(renderComposer(label, draft, draft.text));
    }
}
function repositionAll() {
    if (!root)
        return;
    const wrappers = root.querySelectorAll('.kapi-comment:not(.kapi-leaving)');
    const targets = [...comments];
    if (draft)
        targets.push(draft);
    wrappers.forEach((wrapper, i) => {
        const target = targets[i];
        if (target)
            position(target, wrapper);
    });
}
window.addEventListener('resize', repositionAll);
window.addEventListener('scroll', repositionAll, true);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && draft)
        cancelDraft();
}, true);
document.addEventListener('click', (e) => {
    if (!draft || !root)
        return;
    // Let a shift-click, or the trailing click a drag-select release fires,
    // fall through to the inspector's blocker instead of canceling — those
    // are how a batch draft's element selection keeps growing while its
    // composer is open.
    if (e.shiftKey || isBoxSelectClick())
        return;
    const target = e.target;
    const kapiHost = root.host;
    if (!kapiHost.contains(target)) {
        e.stopImmediatePropagation();
        cancelDraft();
        clearHighlightIfNotInspecting();
    }
}, true);
function submitDraft(rawText) {
    if (!draft)
        return;
    const text = rawText.trim();
    if (!text) {
        cancelDraft();
        return;
    }
    if (draft.els) {
        const targets = draft.els.map((el) => ({
            el,
            source: getSourceLocation(el),
            component: getComponentInfo(el),
        }));
        comments.push({
            id: comments.length + 1,
            el: draft.el,
            ratioX: 0.5,
            ratioY: 0.5,
            text,
            source: targets[0]?.source ?? null,
            component: targets[0]?.component ?? null,
            targets,
        });
    }
    else if (draft.id !== undefined) {
        const entry = comments.find((c) => c.id === draft.id);
        if (entry)
            entry.text = text;
    }
    else {
        comments.push({
            id: comments.length + 1,
            el: draft.el,
            ratioX: draft.ratioX,
            ratioY: draft.ratioY,
            text,
            source: getSourceLocation(draft.el),
            component: getComponentInfo(draft.el),
        });
    }
    draft = null;
    unlockHighlight();
    clearSelection();
    clearPreview();
    saveToStorage();
    render();
}
function cancelDraft() {
    const node = root?.querySelector('.kapi-comment-composer')?.closest('.kapi-comment');
    if (node)
        animateOut(node);
    draft = null;
    unlockHighlight();
    clearSelection();
    clearPreview();
    render();
}
export function cancelOpenDraft() {
    if (draft)
        cancelDraft();
}
export function buildCommentsPrompt() {
    if (comments.length === 0)
        return null;
    const describe = (el, source, component) => {
        const location = source ? `${source.file}:${source.line}:${source.column}` : buildUniqueSelector(el);
        const componentTag = component ? `<${component.name}> ` : '';
        return `${componentTag}${location}`;
    };
    const lines = comments.map((c) => {
        const locations = c.targets?.length
            ? c.targets.map((t) => describe(t.el, t.source, t.component)).join(', ')
            : describe(c.el, c.source, c.component);
        return `${c.id}. [${locations}] feedback: ${c.text}`;
    });
    return [
        'Address each of the following review comments left on specific elements in this app:',
        '',
        ...lines,
    ].join('\n');
}
// Builds one prompt covering comments from every page, read straight from
// localStorage (each page persists under `kapi-comments:<pathname>`). Other
// pages aren't in the DOM, so locations come from the stored selector/source
// rather than a live element.
export function buildAllCommentsPrompt() {
    const describe = (selector, source, component) => {
        const location = source ? `${source.file}:${source.line}:${source.column}` : selector;
        return `${component ? `<${component.name}> ` : ''}${location}`;
    };
    const sections = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('kapi-comments:'))
            continue;
        let data;
        try {
            data = JSON.parse(localStorage.getItem(key) || '[]');
        }
        catch {
            continue; // skip corrupt entry
        }
        if (!data.length)
            continue;
        const lines = data.map((c) => {
            const locations = c.targets?.length
                ? c.targets.map((t) => describe(t.selector, t.source, t.component)).join(', ')
                : describe(c.selector, c.source, c.component);
            return `${c.id}. [${locations}] feedback: ${c.text}`;
        });
        sections.push([`## Page: ${key.slice('kapi-comments:'.length)}`, ...lines].join('\n'));
    }
    if (!sections.length)
        return null;
    return [
        'Address each of the following review comments left on specific elements in this app, grouped by page:',
        '',
        ...sections,
    ].join('\n\n');
}
export function clearAllComments() {
    root?.querySelectorAll('.kapi-comment').forEach((n) => animateOut(n));
    comments = [];
    if (draft) {
        draft = null;
        unlockHighlight();
        clearPreview();
    }
    try {
        localStorage.removeItem(storageKey);
    }
    catch {
        /* ignore (storage disabled) */
    }
    render();
}
export function beginComment(el, clientX, clientY) {
    if (isDisabled() || draft)
        return;
    const rect = el.getBoundingClientRect();
    const ratioX = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0.5;
    const ratioY = rect.height > 0 ? clamp((clientY - rect.top) / rect.height, 0, 1) : 0.5;
    draft = { el, ratioX, ratioY };
    lockHighlightOn(el);
    render();
}
// Called on every shift-click/drag-select change in inspector.ts. Keeps one
// shared composer live as the selection grows or shrinks, so no separate
// "commit" click is needed. On submit, one CommentEntry per selected element
// is created with the same text.
export function updateSelection(els) {
    if (isDisabled())
        return;
    if (els.length === 0) {
        if (draft?.els)
            cancelDraft();
        return;
    }
    // A normal single comment/edit is already in progress (reachable if a
    // shift-click lands while editing an existing comment) — leave it alone.
    if (draft && !draft.els)
        return;
    const anchor = els[els.length - 1];
    if (draft?.els) {
        // Preserve whatever the user has typed so far across the re-render.
        const input = root?.querySelector('.kapi-comment-input');
        if (input)
            draft.text = input.value;
        draft.els = els;
        draft.el = anchor;
    }
    else {
        draft = { el: anchor, ratioX: 0.5, ratioY: 0.5, els };
    }
    lockWithoutHighlight();
    render();
}
function deleteComment(id) {
    const node = root?.querySelector('.kapi-comment-composer')?.closest('.kapi-comment');
    if (node)
        animateOut(node);
    comments = comments.filter((c) => c.id !== id);
    // Renumber so ids stay contiguous (1..n) and match marker labels.
    comments.forEach((c, i) => (c.id = i + 1));
    draft = null;
    unlockHighlight();
    clearPreview();
    saveToStorage();
    render();
}
function beginEdit(entry) {
    if (isDisabled())
        return;
    if (draft)
        cancelDraft();
    draft = { el: entry.el, ratioX: entry.ratioX, ratioY: entry.ratioY, id: entry.id, text: entry.text };
    if (entry.targets && entry.targets.length > 1) {
        previewElements(entry.targets.map((t) => t.el));
        lockWithoutHighlight();
    }
    else {
        lockHighlightOn(entry.el);
    }
    render();
}
// In an SPA, client-side navigation (Vue Router, etc.) changes
// location.pathname without reloading this script. Patch history's
// navigation methods and listen for back/forward/hash changes so comments
// stay scoped to whichever page is actually showing.
function handleNavigation() {
    if (location.pathname === currentPathname)
        return;
    currentPathname = location.pathname;
    storageKey = `kapi-comments:${currentPathname}`;
    if (draft)
        cancelDraft();
    comments = [];
    // Vue Router updates the DOM asynchronously after pushState/popstate fires,
    // so querying for saved selectors must wait a frame for the new page to render.
    requestAnimationFrame(() => {
        loadFromStorage();
        render();
    });
}
function watchForNavigation() {
    const originalPushState = history.pushState.bind(history);
    history.pushState = function (...args) {
        originalPushState(...args);
        handleNavigation();
    };
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function (...args) {
        originalReplaceState(...args);
        handleNavigation();
    };
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);
}
watchForNavigation();
loadFromStorage();
render();
