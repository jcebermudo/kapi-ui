import assert from 'node:assert/strict'
import { recordPosition, findTraceFromElement } from '../dist/browser/trace-record.js'

// Vite can add a dependency version to the inspector's import but leave
// the compiler-injected import unversioned. These are distinct modules.
const inspectorCopy = await import('../dist/browser/trace-record.js?v=nuxt-test')
const location = { file: 'app/components/Button.vue', line: 12, column: 0 }
const vnode = { __v_isVNode: true, props: null }
const el = { __vnode: vnode, parentElement: null }

assert.equal(recordPosition(location.file, location.line, location.column, vnode), vnode)
assert.deepEqual(findTraceFromElement(el), location)
assert.deepEqual(inspectorCopy.findTraceFromElement(el), location,
  'versioned and unversioned modules must share recorded locations')

// Reloading the recorder must preserve already-mounted element locations.
const hotCopy = await import('../dist/browser/trace-record.js?t=hot-update')
assert.deepEqual(hotCopy.findTraceFromElement(el), location)
const rerendered = { __v_isVNode: true, props: {} }
hotCopy.recordPosition(location.file, 13, 4, rerendered)
assert.deepEqual(inspectorCopy.findTraceFromElement({ __vnode: rerendered }),
  { ...location, line: 13, column: 4 })
assert.deepEqual(findTraceFromElement(el), location)

// Preserve Vue's shared-props clone lookup and unresolved-element behavior.
assert.deepEqual(findTraceFromElement({ __vnode: { ...vnode } }), location)
assert.equal(findTraceFromElement({}), null)
assert.equal(findTraceFromElement({ __vnode: { props: {} } }), null)

// A user-defined h() may return something other than a Vue vnode.
for (const value of [null, 'text', 42, {}]) {
  assert.equal(recordPosition('ignored.vue', 1, 0, value), value)
  if (value && typeof value === 'object') assert.equal('props' in value, false)
}

console.log('Source-location checks passed (duplicate imports, hot reload, rerender, clones).')
