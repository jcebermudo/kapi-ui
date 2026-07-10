import { startInspecting, stopInspecting, setOnHover, setOnElementClick, setDisabled, describeElement } from './inspector.js';
import { updateHoverPanel, showProcessingStatus } from './hover-panel.js';
import { beginComment, clearAllComments, cancelOpenDraft, buildCommentsPrompt } from './comments.js';
import { connectSocket, sendComments, setOnCommentsDone, setOnCommentsProcessing } from './socket.js';
import { LOGO_SVG, AI_SVG, DELETE_SVG } from './icons.js';
const KAPI_TAG = 'kapi-overlay';
const POSITION_KEY = 'kapi-overlay-position';
const DRAG_THRESHOLD = 4;
const COLLAPSED_WIDTH = 40;
const BAR_HEIGHT = 40;
const INSET = 20;
const STYLES = `
  :host {
    /* Reset anything inheritable coming from the host page. */
    all: initial;

    --kapi-bg: #1e1e1f;
    --kapi-bg-hover: #3b3b3f;
    --kapi-bg-active: #3b3b3f;
    --kapi-ring: rgba(255, 255, 255, 0.14);
    --kapi-divider: rgba(255, 255, 255, 0.16);

    position: fixed;
    top: 0;
    left: 0;
    z-index: 2147483647;
    color-scheme: dark;
    touch-action: none;
  }

  .kapi-bar {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    width: ${COLLAPSED_WIDTH}px;
    height: ${BAR_HEIGHT}px;
    padding: 4px;
    gap: 6px;
    border-radius: 12px;
    background: var(--kapi-bg);
    box-shadow:
      inset 0 0 0 1px var(--kapi-ring),
      0 2px 4px rgba(0, 0, 0, 0.2),
      0 8px 16px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    transition:
      width 260ms cubic-bezier(0.34, 1.56, 0.64, 1),
      border-radius 260ms ease;
    transition-delay: 120ms, 120ms;
  }

  .kapi-bar.kapi-expanded {
    width: var(--kapi-expanded-width, ${COLLAPSED_WIDTH}px);
    border-radius: 12px;
    transition-delay: 0ms, 0ms;
  }

  .kapi-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    flex: none;
    width: 32px;
    height: 32px;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: background 150ms ease, transform 150ms ease;
  }

  .kapi-btn:hover {
    background: var(--kapi-bg-hover);
  }

  .kapi-btn:active {
    background: var(--kapi-bg-active);
    transform: scale(0.92);
    transition: none;
  }

  .kapi-btn:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }

  .kapi-logo-btn {
    cursor: pointer;
    touch-action: none;
  }

  .kapi-logo-btn.kapi-dragging {
    cursor: grabbing;
    background: var(--kapi-bg-active);
    transform: scale(0.95);
    transition: none;
  }

  .kapi-icon {
    pointer-events: none;
  }

  .kapi-logo-icon {
    width: 18px;
    height: auto;
    margin-top: 2px;
    animation: kapi-bounce 1.6s ease-in-out infinite;
  }

  .kapi-logo-btn.kapi-dragging .kapi-logo-icon {
    animation-play-state: paused;
  }

  @keyframes kapi-bounce {
    0%, 100% {
      transform: translateY(0) rotate(0deg);
    }
    50% {
      transform: translateY(-3px) rotate(-6deg);
    }
  }

  .kapi-ai-icon {
    width: 16.5px;
    height: auto;
  }

  .kapi-delete-icon {
    width: 15.5px;
    height: auto;
  }

  .kapi-extra {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    opacity: 0;
    transform: scale(0.9);
    transition: opacity 160ms ease, transform 160ms ease;
    transition-delay: 0ms;
  }

  .kapi-bar.kapi-expanded .kapi-extra {
    opacity: 1;
    transform: scale(1);
    transition-delay: 140ms;
  }

  .kapi-btn-group {
    display: flex;
    align-items: center;
    gap: 0;
    flex: none;
  }

  .kapi-divider {
    flex: none;
    width: 1px;
    height: 18px;
    background: var(--kapi-divider);
  }

  @media (prefers-reduced-motion: reduce) {
    .kapi-bar,
    .kapi-btn,
    .kapi-extra {
      transition: none;
    }

    .kapi-logo-icon {
      animation: none;
    }
  }
`;
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
export function insertOverlay() {
    if (document.querySelector(KAPI_TAG))
        return;
    connectSocket();
    const host = document.createElement(KAPI_TAG);
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
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
    const aiBtn = document.createElement('button');
    aiBtn.className = 'kapi-btn';
    aiBtn.type = 'button';
    aiBtn.setAttribute('aria-label', 'AI');
    aiBtn.innerHTML = AI_SVG;
    aiBtn.addEventListener('click', () => {
        const prompt = buildCommentsPrompt();
        if (prompt)
            sendComments(prompt);
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'kapi-btn';
    deleteBtn.type = 'button';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.innerHTML = DELETE_SVG;
    deleteBtn.addEventListener('click', () => clearAllComments());
    const btnGroup = document.createElement('div');
    btnGroup.className = 'kapi-btn-group';
    btnGroup.append(aiBtn, deleteBtn);
    extra.append(makeDivider(), btnGroup);
    bar.append(logoBtn, extra);
    root.append(style, bar);
    document.body.appendChild(host);
    setOnHover((el) => {
        updateHoverPanel(el ? describeElement(el) : null);
    });
    setOnElementClick((el, clientX, clientY) => {
        beginComment(el, clientX, clientY);
    });
    setOnCommentsProcessing((status) => {
        cancelOpenDraft();
        setDisabled(true);
        showProcessingStatus(status);
    });
    setOnCommentsDone(() => {
        clearAllComments();
        setDisabled(false);
        if (expanded)
            startInspecting();
        updateHoverPanel(null);
    });
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
    logoBtn.addEventListener('click', () => setExpanded(!expanded));
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
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => insertOverlay(), { once: true });
}
else {
    insertOverlay();
}
