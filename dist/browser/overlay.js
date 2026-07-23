import { startInspecting, stopInspecting, setOnHover, setOnElementClick, setOnSelectionChange, setDisabled } from './inspector.js';
import { updateHoverPanel, showProcessingStatus } from './hover-panel.js';
import { beginComment, updateSelection, clearAllComments, cancelOpenDraft, buildAllCommentsPrompt } from './comments.js';
import { connectSocket, sendComments, stopComments, setOnCommentsDone, setOnCommentsError, setOnCommentsProcessing } from './socket.js';
import { LOGO_SVG, AI_SVG, COPY_SVG, CHECK_SVG, DELETE_SVG, STOP_SVG } from './icons.js';
import styles from './styles/overlay.css?inline';
const KAPI_TAG = 'kapi-overlay';
const POSITION_KEY = 'kapi-overlay-position';
const DRAG_THRESHOLD = 4;
const COLLAPSED_WIDTH = 40;
const BAR_HEIGHT = 40;
const INSET = 20;
function loadPosition() {
    try {
        const raw = localStorage.getItem(POSITION_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number')
            return parsed;
    }
    catch {
        /* ignore corrupt/inaccessible storage */
    }
    return null;
}
function savePosition(position) {
    try {
        localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    }
    catch {
        /* ignore (e.g. storage disabled) */
    }
}
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
/** Creates and wires up the floating Kapi overlay. */
export function insertOverlay() {
    // 1. Only one overlay may exist on a page.
    if (document.querySelector(KAPI_TAG))
        return;
    connectSocket();
    // 2. Build the Shadow DOM UI. Its styles stay isolated from the host page.
    const host = document.createElement(KAPI_TAG);
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styles;
    const bar = document.createElement('div');
    bar.className = 'kapi-bar';
    const logoBtn = document.createElement('button');
    logoBtn.className = 'kapi-btn kapi-logo-btn';
    logoBtn.type = 'button';
    logoBtn.setAttribute('aria-label', 'Toggle Kapi');
    logoBtn.setAttribute('aria-expanded', 'false');
    logoBtn.innerHTML = LOGO_SVG;
    const extra = document.createElement('div');
    extra.className = 'kapi-extra';
    const makeDivider = () => {
        const divider = document.createElement('span');
        divider.className = 'kapi-divider';
        return divider;
    };
    // The vite plugin / nuxt module injects this global only when the agent
    // session is disabled (`agent: false`); default (undefined) means enabled.
    const agentEnabled = window.__KAPI_AGENT_ENABLED__ !== false;
    const aiBtn = document.createElement('button');
    aiBtn.className = 'kapi-btn';
    aiBtn.type = 'button';
    aiBtn.setAttribute('aria-label', 'AI');
    aiBtn.innerHTML = AI_SVG;
    aiBtn.addEventListener('click', () => {
        const prompt = buildAllCommentsPrompt();
        if (prompt)
            sendComments(prompt);
    });
    const copyBtn = document.createElement('button');
    copyBtn.className = 'kapi-btn';
    copyBtn.type = 'button';
    copyBtn.setAttribute('aria-label', 'Copy');
    copyBtn.innerHTML = COPY_SVG;
    // Swap the button icon (copy <-> checkmark) with a fade/scale/blur out-then-in.
    const swapCopyIcon = (svg, done) => {
        copyBtn.classList.remove('kapi-copy-in');
        copyBtn.classList.add('kapi-copy-out');
        setTimeout(() => {
            copyBtn.innerHTML = svg;
            copyBtn.classList.replace('kapi-copy-out', 'kapi-copy-in');
            setTimeout(() => {
                copyBtn.classList.remove('kapi-copy-in');
                done?.();
            }, 180);
        }, 180);
    };
    copyBtn.addEventListener('click', async () => {
        const prompt = buildAllCommentsPrompt();
        if (!prompt)
            return;
        try {
            await navigator.clipboard.writeText(prompt);
        }
        catch {
            return; // clipboard blocked; no success feedback
        }
        copyBtn.classList.add('kapi-busy'); // clicks disabled until we're back to the copy icon
        swapCopyIcon(CHECK_SVG, () => setTimeout(() => swapCopyIcon(COPY_SVG, () => copyBtn.classList.remove('kapi-busy')), 1000));
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'kapi-btn';
    deleteBtn.type = 'button';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.innerHTML = DELETE_SVG;
    deleteBtn.addEventListener('click', () => clearAllComments());
    const btnGroup = document.createElement('div');
    btnGroup.className = 'kapi-btn-group';
    // Manual mode (agent disabled) drops the AI "send" button — Copy/Delete stay.
    btnGroup.append(...(agentEnabled ? [aiBtn] : []), copyBtn, deleteBtn);
    extra.append(makeDivider(), btnGroup);
    bar.append(logoBtn, extra);
    root.append(style, bar);
    document.body.appendChild(host);
    // 3. Connect the overlay to the element inspector.
    setOnHover((el) => {
        updateHoverPanel(el);
    });
    setOnElementClick((el, clientX, clientY) => {
        beginComment(el, clientX, clientY);
    });
    setOnSelectionChange((els) => {
        updateSelection(els);
    });
    // 4. Track comment-processing state and control the logo button.
    let isProcessing = false;
    let wasStopped = false;
    const handleLogoClick = () => setExpanded(!expanded);
    const handleStopClick = () => {
        wasStopped = true;
        stopComments();
    };
    let logoSwapTimeout = null;
    let logoSwapInnerTimeout = null;
    const clearPendingLogoSwap = () => {
        if (logoSwapTimeout !== null)
            clearTimeout(logoSwapTimeout);
        if (logoSwapInnerTimeout !== null)
            clearTimeout(logoSwapInnerTimeout);
        logoSwapTimeout = null;
        logoSwapInnerTimeout = null;
    };
    const swapLogo = (svg) => {
        clearPendingLogoSwap();
        logoBtn.classList.remove('kapi-animating-in');
        logoBtn.classList.add('kapi-animating-out');
        logoSwapTimeout = setTimeout(() => {
            logoBtn.innerHTML = svg;
            logoBtn.classList.remove('kapi-animating-out');
            logoBtn.classList.add('kapi-animating-in');
            logoSwapInnerTimeout = setTimeout(() => {
                logoBtn.classList.remove('kapi-animating-in');
                logoSwapInnerTimeout = null;
            }, 200);
            logoSwapTimeout = null;
        }, 200);
    };
    const swapLogoToStop = () => {
        swapLogo(STOP_SVG);
        logoBtn.classList.add('kapi-stop-mode');
        logoBtn.removeEventListener('click', handleLogoClick);
        logoBtn.addEventListener('click', handleStopClick);
    };
    const restoreLogoFromStop = () => {
        swapLogo(LOGO_SVG);
        logoBtn.classList.remove('kapi-stop-mode');
        logoBtn.removeEventListener('click', handleStopClick);
        logoBtn.addEventListener('click', handleLogoClick);
    };
    const finishProcessing = (clearComments) => {
        isProcessing = false;
        restoreLogoFromStop();
        if (clearComments && !wasStopped)
            clearAllComments();
        setDisabled(false);
        setExpanded(true);
        updateHoverPanel(null);
    };
    // 5. Reflect comment-processing lifecycle events in the UI.
    setOnCommentsProcessing((status) => {
        if (isProcessing) {
            showProcessingStatus(status);
            return;
        }
        cancelOpenDraft();
        setDisabled(true);
        isProcessing = true;
        wasStopped = false;
        setExpanded(false);
        swapLogoToStop();
        showProcessingStatus(status);
    });
    setOnCommentsDone(() => {
        finishProcessing(true);
    });
    setOnCommentsError((message) => {
        finishProcessing(false);
        showProcessingStatus(`Error: ${message}`);
    });
    // 6. Expand/collapse the toolbar and keep it on screen.
    let expanded = false;
    const measureExpandedWidth = () => {
        const barStyle = getComputedStyle(bar);
        const paddingX = parseFloat(barStyle.paddingLeft) + parseFloat(barStyle.paddingRight);
        const gap = parseFloat(barStyle.columnGap || barStyle.gap) || 0;
        const width = Math.round(logoBtn.offsetWidth + gap + extra.offsetWidth + paddingX);
        bar.style.setProperty('--kapi-expanded-width', `${width}px`);
        return width;
    };
    let expandedWidth = measureExpandedWidth();
    const currentSize = () => ({
        width: expanded ? expandedWidth : COLLAPSED_WIDTH,
        height: BAR_HEIGHT,
    });
    const place = (left, top) => {
        const { width, height } = currentSize();
        const maxLeft = window.innerWidth - width - INSET;
        const maxTop = window.innerHeight - height - INSET;
        host.style.left = `${clamp(left, INSET, Math.max(INSET, maxLeft))}px`;
        host.style.top = `${clamp(top, INSET, Math.max(INSET, maxTop))}px`;
    };
    const setExpanded = (next) => {
        if (expanded === next)
            return;
        if (next)
            expandedWidth = measureExpandedWidth();
        expanded = next;
        bar.classList.toggle('kapi-expanded', expanded);
        logoBtn.setAttribute('aria-expanded', String(expanded));
        const rect = host.getBoundingClientRect();
        place(rect.left, rect.top);
        if (expanded) {
            startInspecting();
        }
        else {
            stopInspecting();
        }
    };
    // 7. Restore the saved position, then keep it valid after viewport changes.
    const saved = loadPosition();
    if (saved) {
        place(saved.left, saved.top);
    }
    else {
        place(INSET, window.innerHeight - COLLAPSED_WIDTH - INSET);
    }
    window.addEventListener('resize', () => {
        const rect = host.getBoundingClientRect();
        place(rect.left, rect.top);
    });
    // 8. Let the logo button drag the overlay without triggering its click action.
    let pointerId = null;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    const suppressNextClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        logoBtn.removeEventListener('click', suppressNextClick, true);
    };
    logoBtn.addEventListener('click', handleLogoClick);
    logoBtn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse')
            return;
        pointerId = e.pointerId;
        dragging = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = host.getBoundingClientRect();
        originLeft = rect.left;
        originTop = rect.top;
        logoBtn.setPointerCapture(pointerId);
    });
    logoBtn.addEventListener('pointermove', (e) => {
        if (e.pointerId !== pointerId)
            return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging) {
            if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD)
                return;
            dragging = true;
            logoBtn.classList.add('kapi-dragging');
            logoBtn.addEventListener('click', suppressNextClick, true);
            stopInspecting();
        }
        place(originLeft + dx, originTop + dy);
    });
    const endDrag = (e) => {
        if (e.pointerId !== pointerId)
            return;
        if (logoBtn.hasPointerCapture(pointerId))
            logoBtn.releasePointerCapture(pointerId);
        pointerId = null;
        if (dragging) {
            logoBtn.classList.remove('kapi-dragging');
            const rect = host.getBoundingClientRect();
            savePosition({ left: rect.left, top: rect.top });
            if (expanded)
                startInspecting();
        }
        dragging = false;
    };
    logoBtn.addEventListener('pointerup', endDrag);
    logoBtn.addEventListener('pointercancel', endDrag);
}
// Insert as soon as the page has a body to receive the overlay.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => insertOverlay(), { once: true });
}
else {
    insertOverlay();
}
