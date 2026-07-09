import { startInspecting, stopInspecting, setOnHover, setOnElementClick, setDisabled, describeElement } from './inspector.js'
import { updateHoverPanel, showProcessingStatus } from './hover-panel.js'
import { beginComment, clearAllComments, cancelOpenDraft, buildCommentsPrompt } from './comments.js'
import { connectSocket, sendComments, setOnCommentsDone, setOnCommentsProcessing } from './socket.js'

const KAPI_TAG = 'kapi-overlay'
const POSITION_KEY = 'kapi-overlay-position'
const DRAG_THRESHOLD = 4
const COLLAPSED_WIDTH = 40
const BAR_HEIGHT = 40
const INSET = 20

const LOGO_SVG = `
<svg class="kapi-icon kapi-logo-icon" viewBox="0 0 43 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M3.731 10.7798C4.7147 6.56519 8.79736 3.83476 13.0683 4.5352L35.423 8.20143C40.6186 9.05351 43.6856 14.5012 41.7194 19.3852L37.1373 30.767C35.8843 33.8795 32.8656 35.9183 29.5104 35.9183L8.22545 35.9183C2.9297 35.9184 -0.984859 30.985 0.218806 25.8279L3.731 10.7798Z" fill="white"/>
  <path d="M16.7357 15.0244C17.1733 15.2681 17.7263 15.1116 17.9701 14.674C18.1986 14.2637 18.0748 13.7526 17.6979 13.4894L17.6188 13.4398L17.608 13.4338C17.6026 13.4308 17.5951 13.4272 17.5865 13.4226C17.5693 13.4134 17.5457 13.401 17.5161 13.3858C17.457 13.3555 17.374 13.3136 17.2696 13.2651C17.0606 13.168 16.7636 13.0411 16.4038 12.9165C15.6928 12.6703 14.6916 12.4178 13.6095 12.4528C12.4621 12.49 11.5001 12.9362 10.8494 13.343C10.5197 13.5491 10.2567 13.7533 10.074 13.9079C9.98233 13.9855 9.91012 14.0516 9.85863 14.1002C9.83301 14.1243 9.81248 14.1443 9.79727 14.1593C9.78976 14.1667 9.78309 14.173 9.7782 14.1779C9.7758 14.1803 9.77378 14.183 9.77202 14.1847C9.77117 14.1856 9.77044 14.1867 9.76974 14.1874L9.76786 14.188L9.76813 14.1889C9.77063 14.1917 9.81101 14.2311 10.4189 14.82L9.76719 14.1892C9.41868 14.549 9.42824 15.1231 9.78804 15.4717C10.1471 15.8196 10.7197 15.812 11.0686 15.4545L11.0692 15.4533C11.07 15.4525 11.0711 15.4516 11.0725 15.4503C11.078 15.4449 11.0885 15.4343 11.1035 15.4202C11.1335 15.3919 11.1815 15.3479 11.2461 15.2933C11.376 15.1834 11.5687 15.0332 11.8112 14.8816C12.3047 14.5731 12.9535 14.2897 13.6689 14.2666C14.4496 14.2415 15.2179 14.4256 15.8104 14.6308C16.1022 14.7319 16.3409 14.8346 16.5043 14.9105C16.5857 14.9484 16.6482 14.979 16.6879 14.9994C16.7077 15.0095 16.7217 15.0175 16.7299 15.0219L16.7357 15.0244Z" fill="#1E1E1F"/>
  <rect width="6.86041" height="9.21865" rx="3.43021" transform="matrix(0.866027 -0.499997 0.500003 0.866024 2.53809 3.43042)" fill="white"/>
  <rect width="6.86041" height="9.21865" rx="3.43021" transform="matrix(0.866027 -0.499997 0.500003 0.866024 13.0454 3.43042)" fill="white"/>
  <ellipse cx="1.75568" cy="2.16083" rx="1.75568" ry="2.16083" transform="matrix(0.763621 -0.645664 -0.64567 -0.763616 30.3809 18.4956)" fill="#1E1E1F"/>
  <ellipse cx="1.75567" cy="2.16083" rx="1.75567" ry="2.16083" transform="matrix(-0.64567 -0.763616 0.763621 -0.645664 36.6602 18.4724)" fill="#1E1E1F"/>
  <path d="M29.7427 30.1657C30.9734 30.6086 32.493 30.6762 34.0379 29.778C34.4709 29.5263 34.6185 28.9718 34.367 28.5387C34.1152 28.1056 33.5598 27.9586 33.1266 28.2104C32.1237 28.7936 31.1761 28.7524 30.3576 28.4578C29.508 28.152 28.8183 27.5742 28.4647 27.1562C28.1412 26.7743 27.5695 26.7266 27.1871 27.0496C26.8046 27.3732 26.7568 27.9456 27.0804 28.3282C27.6018 28.9446 28.5433 29.7339 29.7427 30.1657Z" fill="#1E1E1F"/>
  <path d="M31.1454 29.5056C32.343 28.4681 33.1357 26.3624 32.6699 24.0613C32.5704 23.5702 32.0916 23.2528 31.6005 23.3523C31.1097 23.4517 30.7924 23.9297 30.8915 24.4206C31.2449 26.1658 30.5984 27.5795 29.9579 28.1345C29.5793 28.4626 29.5381 29.0351 29.8661 29.4138C30.1942 29.7925 30.7668 29.8336 31.1454 29.5056Z" fill="#1E1E1F"/>
</svg>
`

const WAND_SVG = `
<svg class="kapi-icon" viewBox="0 0 7 7" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M3.8742 1.77467L4.77412 2.67453M1.17446 1.47472V2.67453M5.37406 3.87434V5.07416M2.67432 0.274902V0.874809M1.77441 2.07462H0.574521M5.974 4.47425H4.77412M2.97429 0.574856H2.37435M6.16598 0.766826L5.78202 0.382886C5.74827 0.348786 5.70809 0.321716 5.66381 0.303242C5.61953 0.284767 5.57202 0.275255 5.52404 0.275255C5.47606 0.275255 5.42856 0.284767 5.38428 0.303242C5.34 0.321716 5.29982 0.348786 5.26607 0.382886L0.382539 5.26613C0.348438 5.29988 0.321366 5.34005 0.302891 5.38433C0.284415 5.42861 0.274902 5.47611 0.274902 5.52409C0.274902 5.57207 0.284415 5.61957 0.302891 5.66384C0.321366 5.70812 0.348438 5.7483 0.382539 5.78205L0.766502 6.16599C0.800045 6.20046 0.840156 6.22785 0.884464 6.24656C0.928773 6.26526 0.976381 6.2749 1.02448 6.2749C1.07257 6.2749 1.12018 6.26526 1.16449 6.24656C1.2088 6.22785 1.24891 6.20046 1.28245 6.16599L6.16598 1.28275C6.20045 1.24921 6.22785 1.2091 6.24656 1.16479C6.26526 1.12048 6.2749 1.07288 6.2749 1.02479C6.2749 0.976693 6.26526 0.929087 6.24656 0.884781C6.22785 0.840475 6.20045 0.800367 6.16598 0.766826Z" stroke="white" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`

const DELETE_SVG = `
<svg class="kapi-icon" viewBox="0 0 7 7" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2.60824 2.9749V4.7749M3.94157 2.9749V4.7749M5.60824 1.4749V5.6749C5.60824 5.83403 5.538 5.98664 5.41297 6.09917C5.28795 6.21169 5.11838 6.2749 4.94157 6.2749H1.60824C1.43142 6.2749 1.26186 6.21169 1.13683 6.09917C1.01181 5.98664 0.941569 5.83403 0.941569 5.6749V1.4749M0.274902 1.4749H6.2749M1.94157 1.4749V0.874902C1.94157 0.715772 2.01181 0.56316 2.13683 0.450638C2.26186 0.338116 2.43142 0.274902 2.60824 0.274902H3.94157C4.11838 0.274902 4.28795 0.338116 4.41297 0.450638C4.538 0.56316 4.60824 0.715772 4.60824 0.874902V1.4749" stroke="white" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`

const STYLES = `
  :host {
    /* Reset anything inheritable coming from the host page. */
    all: initial;

    --kapi-bg: #1e1e1f;
    --kapi-bg-hover: #2a2a2b;
    --kapi-bg-active: #161617;
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
  }

  .kapi-btn:not(.kapi-logo-btn) .kapi-icon {
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

  .kapi-btn-group {
    display: flex;
    align-items: center;
    gap: 0;
    flex: none;
  }

  .kapi-bar.kapi-expanded .kapi-extra {
    opacity: 1;
    transform: scale(1);
    transition-delay: 140ms;
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
  }
`

interface Position {
  left: number
  top: number
}

function loadPosition(): Position | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number') return parsed
  } catch {
    /* ignore corrupt/inaccessible storage */
  }
  return null
}

function savePosition(position: Position) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position))
  } catch {
    /* ignore (e.g. storage disabled) */
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function insertOverlay() {
  if (document.querySelector(KAPI_TAG)) return

  connectSocket()

  const host = document.createElement(KAPI_TAG)
  const root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = STYLES

  const bar = document.createElement('div')
  bar.className = 'kapi-bar'

  const logoBtn = document.createElement('button')
  logoBtn.className = 'kapi-btn kapi-logo-btn'
  logoBtn.type = 'button'
  logoBtn.setAttribute('aria-label', 'Toggle Kapi')
  logoBtn.setAttribute('aria-expanded', 'false')
  logoBtn.innerHTML = LOGO_SVG

  const extra = document.createElement('div')
  extra.className = 'kapi-extra'

  const makeDivider = () => {
    const divider = document.createElement('span')
    divider.className = 'kapi-divider'
    return divider
  }

  const wandBtn = document.createElement('button')
  wandBtn.className = 'kapi-btn'
  wandBtn.type = 'button'
  wandBtn.setAttribute('aria-label', 'Magic wand')
  wandBtn.innerHTML = WAND_SVG
  wandBtn.addEventListener('click', () => {
    const prompt = buildCommentsPrompt()
    if (prompt) sendComments(prompt)
  })

  const deleteBtn = document.createElement('button')
  deleteBtn.className = 'kapi-btn'
  deleteBtn.type = 'button'
  deleteBtn.setAttribute('aria-label', 'Delete')
  deleteBtn.innerHTML = DELETE_SVG
  deleteBtn.addEventListener('click', () => clearAllComments())

  const btnGroup = document.createElement('div')
  btnGroup.className = 'kapi-btn-group'
  btnGroup.append(wandBtn, deleteBtn)

  extra.append(makeDivider(), btnGroup)
  bar.append(logoBtn, extra)
  root.append(style, bar)
  document.body.appendChild(host)

  setOnHover((el) => {
    updateHoverPanel(el ? describeElement(el) : null)
  })

  setOnElementClick((el, clientX, clientY) => {
    beginComment(el, clientX, clientY)
  })

  setOnCommentsProcessing((status) => {
    cancelOpenDraft()
    setDisabled(true)
    showProcessingStatus(status)
  })

  setOnCommentsDone(() => {
    clearAllComments()
    setDisabled(false)
    if (expanded) startInspecting()
    updateHoverPanel(null)
  })

  let expanded = false

  const measureExpandedWidth = () => {
    const barStyle = getComputedStyle(bar)
    const paddingX = parseFloat(barStyle.paddingLeft) + parseFloat(barStyle.paddingRight)
    const gap = parseFloat(barStyle.columnGap || barStyle.gap) || 0
    const width = Math.round(logoBtn.offsetWidth + gap + extra.offsetWidth + paddingX)
    bar.style.setProperty('--kapi-expanded-width', `${width}px`)
    return width
  }

  let expandedWidth = measureExpandedWidth()

  const currentSize = () => ({
    width: expanded ? expandedWidth : COLLAPSED_WIDTH,
    height: BAR_HEIGHT,
  })

  const place = (left: number, top: number) => {
    const { width, height } = currentSize()
    const maxLeft = window.innerWidth - width - INSET
    const maxTop = window.innerHeight - height - INSET
    host.style.left = `${clamp(left, INSET, Math.max(INSET, maxLeft))}px`
    host.style.top = `${clamp(top, INSET, Math.max(INSET, maxTop))}px`
  }

  const setExpanded = (next: boolean) => {
    if (expanded === next) return
    if (next) expandedWidth = measureExpandedWidth()
    expanded = next
    bar.classList.toggle('kapi-expanded', expanded)
    logoBtn.setAttribute('aria-expanded', String(expanded))
    const rect = host.getBoundingClientRect()
    place(rect.left, rect.top)

    if (expanded) {
      startInspecting()
    } else {
      stopInspecting()
    }
  }

  const saved = loadPosition()
  if (saved) {
    place(saved.left, saved.top)
  } else {
    place(INSET, window.innerHeight - COLLAPSED_WIDTH - INSET)
  }

  window.addEventListener('resize', () => {
    const rect = host.getBoundingClientRect()
    place(rect.left, rect.top)
  })

  let pointerId: number | null = null
  let dragging = false
  let startX = 0
  let startY = 0
  let originLeft = 0
  let originTop = 0

  const suppressNextClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    logoBtn.removeEventListener('click', suppressNextClick, true)
  }

  logoBtn.addEventListener('click', () => setExpanded(!expanded))

  logoBtn.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    pointerId = e.pointerId
    dragging = false
    startX = e.clientX
    startY = e.clientY
    const rect = host.getBoundingClientRect()
    originLeft = rect.left
    originTop = rect.top
    logoBtn.setPointerCapture(pointerId)
  })

  logoBtn.addEventListener('pointermove', (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY

    if (!dragging) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
      dragging = true
      logoBtn.classList.add('kapi-dragging')
      logoBtn.addEventListener('click', suppressNextClick, true)
      stopInspecting()
    }

    place(originLeft + dx, originTop + dy)
  })

  const endDrag = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return
    if (logoBtn.hasPointerCapture(pointerId)) logoBtn.releasePointerCapture(pointerId)
    pointerId = null
    if (dragging) {
      logoBtn.classList.remove('kapi-dragging')
      const rect = host.getBoundingClientRect()
      savePosition({ left: rect.left, top: rect.top })
      if (expanded) startInspecting()
    }
    dragging = false
  }

  logoBtn.addEventListener('pointerup', endDrag)
  logoBtn.addEventListener('pointercancel', endDrag)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => insertOverlay(), { once: true })
} else {
  insertOverlay()
}
