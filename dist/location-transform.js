import { parse } from '@vue/compiler-sfc';
import { NodeTypes } from '@vue/compiler-core';
function stampElements(node, relativeFile, inserts) {
    if (node.type === NodeTypes.ELEMENT) {
        const { line, column, offset } = node.loc.start;
        inserts.push({
            offset: offset + 1 + node.tag.length,
            text: ` data-kapi-loc="${relativeFile}:${line}:${column}"`,
        });
        for (const child of node.children)
            stampElements(child, relativeFile, inserts);
    }
}
/**
 * Stamps every element inside a Vue SFC's <template> block with a
 * `data-kapi-loc="relativeFile:line:column"` attribute. Parses the template
 * with Vue's own compiler so tag boundaries (comments, `v-if="a > b"`,
 * self-closing tags, etc.) are resolved exactly the way Vue itself resolves
 * them, rather than approximated with a regex.
 */
export function stampTemplateLocations(code, relativeFile) {
    let descriptor;
    try {
        ;
        ({ descriptor } = parse(code, { filename: relativeFile }));
    }
    catch {
        return code;
    }
    const template = descriptor.template;
    if (!template || !template.ast)
        return code;
    const inserts = [];
    for (const child of template.ast.children)
        stampElements(child, relativeFile, inserts);
    if (inserts.length === 0)
        return code;
    inserts.sort((a, b) => a.offset - b.offset);
    let result = '';
    let cursor = 0;
    for (const { offset, text } of inserts) {
        result += code.slice(cursor, offset) + text;
        cursor = offset;
    }
    result += code.slice(cursor);
    return result;
}
