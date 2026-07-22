import path from 'path';
import { fileURLToPath } from 'url';
import { searchForWorkspaceRoot } from 'vite';
import { walk } from 'estree-walker';
import MagicString from 'magic-string';
import { SourceMapConsumer } from 'source-map-js';
import { startServer } from './server.js';
import { KAPI_SERVER_PORT } from '../constants.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const overlayPath = path.resolve(__dirname, '../browser/overlay.js');
const traceRecordPath = path.resolve(__dirname, '../browser/trace-record.js');
// Names Vue's SFC compiler emits in a component's compiled render function
// for every vnode it creates. Wrapping calls to these — rather than parsing
// the original template — means coverage always matches whatever Vue itself
// just compiled, including dynamic `h()` calls a template-source parser would
// never see.
const VNODE_FUNCTIONS = [
    'h',
    '_createElementVNode',
    '_createElementBlock',
    '_createBlock',
    '_createVNode',
    '_createStaticVNode',
];
const vnodeCallRe = new RegExp(`\\b(?:${VNODE_FUNCTIONS.join('|')})\\(`);
const INSTRUMENTED_MARKER = '/* kapi-ui:instrumented */';
// Byte offset of the start of each line (line 1 starts at offset 0). Built
// once per file so looking up a call's line/column is a binary search
// instead of re-scanning from the start of the file for every vnode call.
function buildLineOffsets(code) {
    const offsets = [0];
    for (let i = 0; i < code.length; i++) {
        if (code[i] === '\n')
            offsets.push(i + 1);
    }
    return offsets;
}
function offsetToPos(lineOffsets, index) {
    let lo = 0;
    let hi = lineOffsets.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineOffsets[mid] <= index)
            lo = mid;
        else
            hi = mid - 1;
    }
    return { line: lo + 1, column: index - lineOffsets[lo] };
}
function createUniqueIdentifier(base, identifiers) {
    let identifier = base;
    let suffix = 1;
    while (identifiers.has(identifier)) {
        identifier = `${base}_${suffix++}`;
    }
    identifiers.add(identifier);
    return identifier;
}
export default function kapi(options = {}) {
    let serverPort = null;
    return {
        name: 'kapi-ui',
        // Must run after @vitejs/plugin-vue has compiled templates into
        // vnode-creation calls — this transform rewrites that compiled output,
        // not the raw SFC source.
        enforce: 'post',
        apply: 'serve',
        config() {
            return {
                server: {
                    fs: {
                        allow: [searchForWorkspaceRoot(process.cwd()), path.dirname(overlayPath)],
                    },
                },
            };
        },
        configureServer() {
            startServer(KAPI_SERVER_PORT, options)
                .then(port => {
                serverPort = port;
            })
                .catch(err => {
                console.error('[kapi] failed to start server', err);
            });
        },
        resolveId(id) {
            if (id === '/@kapi-ui/overlay')
                return overlayPath;
            if (id === '/@kapi-ui/trace-record')
                return traceRecordPath;
        },
        transform(code, id) {
            // `this.environment` only exists on Vite 6+ (the Environment API); vite
            // is a devDependency here, not a peerDependency, so kapi has no control
            // over the Vite version in the host project. Treat its absence as
            // "client" so pre-6 Vite still runs the transform instead of throwing
            // on every module.
            if (this.environment && this.environment.name !== 'client')
                return;
            if (id.includes('/node_modules/'))
                return;
            // Only Vue SFC compiled output contains this — cheap enough to check
            // before parsing every transformed module in the project.
            if (!code.includes('_sfc_render('))
                return;
            if (!vnodeCallRe.test(code))
                return;
            if (code.includes(INSTRUMENTED_MARKER))
                return;
            const map = this.getCombinedSourcemap();
            const consumer = new SourceMapConsumer(map);
            const s = new MagicString(code);
            const ast = this.parse(code);
            const lineOffsets = buildLineOffsets(code);
            const identifiers = new Set();
            let hit = false;
            walk(ast, {
                enter(node) {
                    if (node.type === 'Identifier')
                        identifiers.add(node.name);
                },
            });
            // Vue's compiled render function shares the module's lexical scope, so
            // reserve names not used anywhere in the parsed module before injecting
            // either the import binding or the tracer helper.
            const recordPositionIdentifier = createUniqueIdentifier('__kapiRecordPosition', identifiers);
            const tracerIdentifier = createUniqueIdentifier('__kapiTracer', identifiers);
            walk(ast, {
                enter(node) {
                    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier')
                        return;
                    if (!VNODE_FUNCTIONS.includes(node.callee.name))
                        return;
                    const { start, end } = node;
                    const original = consumer.originalPositionFor(offsetToPos(lineOffsets, start));
                    if (original.source === null)
                        return;
                    hit = true;
                    s.appendLeft(start, `${tracerIdentifier}(${original.line},${original.column},`);
                    s.appendRight(end, ')');
                },
            });
            if (!hit)
                return;
            const relativeFile = path.relative(process.cwd(), id.split('?')[0]);
            s.prepend(`${INSTRUMENTED_MARKER}\nimport { recordPosition as ${recordPositionIdentifier} } from "/@kapi-ui/trace-record"\n`);
            s.append(`\nfunction ${tracerIdentifier}(line, column, vnode) { return ${recordPositionIdentifier}(${JSON.stringify(relativeFile)}, line, column, vnode) }\n`);
            return { code: s.toString(), map: s.generateMap({ hires: true }) };
        },
        async transformIndexHtml(html) {
            if (serverPort === null) {
                serverPort = await startServer(KAPI_SERVER_PORT, options);
            }
            return {
                html,
                tags: [
                    {
                        tag: 'script',
                        children: `window.__KAPI_PORT__ = ${serverPort}`,
                        injectTo: 'body',
                    },
                    {
                        tag: 'script',
                        attrs: { type: 'module', src: '/@kapi-ui/overlay' },
                        injectTo: 'body',
                    },
                ],
            };
        },
    };
}
