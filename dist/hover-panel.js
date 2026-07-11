const PANEL_TAG = 'kapi-hover-panel';
const STYLES = `
  :host {
    all: initial;
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 2147483647;
    color-scheme: dark;
  }

  .kapi-hover-panel {
    display: none;
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
export function updateHoverPanel(location) {
    const el = ensurePanel();
    if (!location) {
        el.classList.remove('kapi-visible');
        return;
    }
    el.replaceChildren();
    if (location.component) {
        const componentEl = document.createElement('div');
        componentEl.className = 'kapi-hover-panel-component';
        componentEl.textContent = `<${location.component.name}>`;
        el.appendChild(componentEl);
    }
    if (location.source) {
        const sourceEl = document.createElement('div');
        sourceEl.className = 'kapi-hover-panel-source';
        sourceEl.textContent = `${location.source.file}:${location.source.line}:${location.source.column}`;
        el.appendChild(sourceEl);
    }
    const selectorEl = document.createElement('div');
    selectorEl.className = 'kapi-hover-panel-selector';
    selectorEl.textContent = location.selector;
    el.appendChild(selectorEl);
    el.classList.add('kapi-visible');
}
export function showProcessingStatus(status) {
    const el = ensurePanel();
    el.replaceChildren();
    const row = document.createElement('div');
    row.className = 'kapi-hover-panel-status';
    const dot = document.createElement('span');
    dot.className = 'kapi-hover-panel-status-dot';
    const text = document.createElement('span');
    text.textContent = status;
    row.append(dot, text);
    el.appendChild(row);
    el.classList.add('kapi-visible');
}
