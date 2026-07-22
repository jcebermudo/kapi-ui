import type { SourceLocation, VNodeLike } from './types.js'

// Vue re-creates vnode objects on every re-render, but a given template
// position's `props` object is a stable identity for that call site within a
// single render pass — good enough to key a lookup that only needs to survive
// from "vnode created" to "el mounted" a few lines later in the same tick.
const vnodeToPos = new WeakMap<object, SourceLocation>()

/**
 * Called by the wrapper the vite plugin injects around every vnode-creation
 * call (`_createElementVNode`, etc.) in a component's compiled render
 * function. Tags the vnode's `props` object with where that call came from in
 * the original `.vue` source, so it can be recovered later via `el.__vnode`.
 */
export function recordPosition<T>(file: string, line: number, column: number, vnode: T): T {
  const node = vnode as unknown as VNodeLike
  // `h(...)` (unlike the underscore-prefixed compiler helpers) can also be a
  // user-defined identifier unrelated to Vue's hyperscript function — only
  // tag objects Vue itself marked as vnodes, so a colliding `h` never gets
  // mutated with a spurious `.props`.
  if (!node || typeof node !== 'object' || node.__v_isVNode !== true) return vnode

  const props = (node.props ??= {})
  vnodeToPos.set(props, { file, line, column })
  return vnode
}

/**
 * Reads Vue's own non-enumerable `el.__vnode` back-reference (set by Vue's
 * renderer on every DOM node it creates) to recover the source location
 * recorded for that exact element, if any.
 */
export function findTraceFromElement(el: Element): SourceLocation | null {
  const vnode = (el as Element & { __vnode?: VNodeLike }).__vnode
  const props = vnode?.props
  return (props && vnodeToPos.get(props)) ?? null
}
