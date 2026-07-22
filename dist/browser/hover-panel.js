import { renderComponentBadge, describeElement } from './inspector.js';
const PANEL_TAG = 'kapi-hover-panel';
const GAP = 6; // px between the hovered element and the panel
const VIEWPORT_MARGIN = 12;
const CORNER_OFFSET = 20; // fallback position (no anchor element) — top-right corner
const STYLES = `
  :host {
    all: initial;
    color-scheme: dark;
    /* Purely informational — never intercept hits, so elementsFromPoint()
       in inspector.ts sees straight through to the element under the cursor
       even when the panel is positioned right on top of it. */
    pointer-events: none;
  }

  .kapi-hover-panel {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2147483647;
    max-width: 360px;
    box-sizing: border-box;
    padding: 8px 12px;
    border-radius: 10px;
    background: #1e1e1f;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.14),
      0 2px 4px rgba(0, 0, 0, 0.2),
      0 8px 16px rgba(0, 0, 0, 0.2);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.75);
    word-break: break-word;
    /* Slides to the new position when hover moves between elements. Has no
       effect on first appearance — the panel goes straight from display:none
       to its initial position, with no prior rendered frame to animate from. */
    transition: transform 120ms ease;
  }

  .kapi-hover-panel.kapi-visible {
    display: block;
  }

  .kapi-hover-panel b {
    color: rgb(74, 222, 128);
    font-weight: 600;
  }

  .kapi-hover-panel-component {
    color: rgb(74, 222, 128);
    font-weight: 600;
  }

  .kapi-hover-panel-source {
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 2px;
  }

  .kapi-hover-panel-selector {
    color: rgba(255, 255, 255, 0.5);
    font-size: 11px;
  }

  .kapi-hover-panel-status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: rgba(255, 255, 255, 0.85);
  }

  .kapi-hover-panel-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgb(74, 222, 128);
    flex: none;
    animation: kapi-pulse 1s ease-in-out infinite;
  }

  @keyframes kapi-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
`;
let host = null;
let panel = null;
function ensurePanel() {
    if (panel)
        return panel;
    host = document.createElement(PANEL_TAG);
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLES;
    root.appendChild(style);
    panel = document.createElement('div');
    panel.className = 'kapi-hover-panel';
    root.appendChild(panel);
    document.body.appendChild(host);
    return panel;
}
// Anchors the panel just below-left of `anchorRect` (the hovered element),
// flipping above it if there's no room below, and clamping to the viewport.
// With no anchor (e.g. during processing, when nothing is hovered), falls
// back to a fixed top-right corner.
function position(anchorRect) {
    const panelEl = ensurePanel();
    const panelRect = panelEl.getBoundingClientRect();
    let left;
    let top;
    if (anchorRect) {
        left = anchorRect.left;
        top = anchorRect.bottom + GAP;
        if (top + panelRect.height > window.innerHeight - VIEWPORT_MARGIN) {
            top = anchorRect.top - panelRect.height - GAP;
        }
    }
    else {
        left = window.innerWidth - panelRect.width - CORNER_OFFSET;
        top = CORNER_OFFSET;
    }
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - panelRect.width - VIEWPORT_MARGIN);
    top = Math.max(top, VIEWPORT_MARGIN);
    panelEl.style.transform = `translate(${left}px, ${top}px)`;
}
export function updateHoverPanel(el) {
    const panelEl = ensurePanel();
    if (!el) {
        panelEl.classList.remove('kapi-visible');
        return;
    }
    const location = describeElement(el);
    panelEl.replaceChildren();
    if (location.component) {
        panelEl.appendChild(renderComponentBadge(location.component, 'kapi-hover-panel-component'));
    }
    if (location.source) {
        const sourceEl = document.createElement('div');
        sourceEl.className = 'kapi-hover-panel-source';
        sourceEl.textContent = `${location.source.file}:${location.source.line}:${location.source.column}`;
        panelEl.appendChild(sourceEl);
    }
    const selectorEl = document.createElement('div');
    selectorEl.className = 'kapi-hover-panel-selector';
    selectorEl.textContent = location.selector;
    panelEl.appendChild(selectorEl);
    panelEl.classList.add('kapi-visible');
    position(el.getBoundingClientRect());
}
export function showProcessingStatus(status) {
    const panelEl = ensurePanel();
    panelEl.replaceChildren();
    const row = document.createElement('div');
    row.className = 'kapi-hover-panel-status';
    const dot = document.createElement('span');
    dot.className = 'kapi-hover-panel-status-dot';
    const text = document.createElement('span');
    text.textContent = status;
    row.append(dot, text);
    panelEl.appendChild(row);
    panelEl.classList.add('kapi-visible');
    position(null);
}
