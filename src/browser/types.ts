// Shared type definitions for the browser tier (overlay, inspector,
// comments, trace-record). Kept separate from implementation so the shapes
// can be referenced without pulling in a module's runtime code.

/** A resolved location in the original `.vue` source. */
export interface SourceLocation {
  file: string
  line: number
  column: number
}

/** Minimal shape of a Vue vnode, as seen by trace-record's tagging logic. */
export interface VNodeLike {
  __v_isVNode?: boolean
  props?: Record<string, unknown> | null
}

/** Component name + source file, resolved off Vue's internals. */
export interface ComponentInfo {
  name: string
  file: string | null
}

// Vue's renderer stamps every DOM node it creates with a non-enumerable
// `__vueParentComponent` pointing at the component instance whose render()
// produced it, so this reads straight off the element instead of walking the
// DOM for a compile-time attribute. `type.__file` is populated by
// @vitejs/plugin-vue in dev builds for devtools, at no extra cost to us.
export interface VueComponentInstance {
  type: { name?: string; __name?: string; __file?: string }
}

/** Everything the hover panel / comment tooltips need to describe an element. */
export interface ElementLocation {
  tag: string
  id: string | null
  classes: string[]
  selector: string
  source: SourceLocation | null
  component: ComponentInfo | null
}

/** One element a consolidated multi-select comment applies to. */
export interface CommentTarget {
  el: Element
  source: SourceLocation | null
  component: ComponentInfo | null
}

/** A submitted comment held in memory, anchored to a live element. */
export interface CommentEntry {
  id: number
  el: Element
  ratioX: number
  ratioY: number
  text: string
  source: SourceLocation | null
  component: ComponentInfo | null
  // Present only for a comment created from a multi-select batch: every
  // element it applies to (including `el`, the anchor used for marker
  // position). Absent for an ordinary single-element comment.
  targets?: CommentTarget[]
}

/** An in-progress comment being composed or edited. */
export interface Draft {
  el: Element
  ratioX: number
  ratioY: number
  // Set when editing an existing comment rather than creating a new one.
  id?: number
  text?: string
  // Set when composing one comment across a multi-selected batch of elements
  // (see inspector.ts's shift-click/drag-select). `el`/ratioX/ratioY above
  // just anchor the composer's on-screen position to the first selected element.
  els?: Element[]
}

/** A comment serialized for localStorage (element referenced by selector). */
export interface StoredComment {
  id: number
  selector: string
  ratioX: number
  ratioY: number
  text: string
  source: SourceLocation | null
  component: ComponentInfo | null
  targets?: { selector: string; source: SourceLocation | null; component: ComponentInfo | null }[]
}

/** The overlay bar's persisted screen position. */
export interface Position {
  left: number
  top: number
}
