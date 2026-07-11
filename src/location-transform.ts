// Matches an opening HTML/Vue tag, tolerating quoted attribute values that
// contain `>` (e.g. `v-if="a > b"`) so we don't mistake them for the tag end.
const TAG_RE = /<([a-zA-Z][\w-]*)(?:\s+[^"'>]*(?:"[^"]*"|'[^']*')?)*\s*\/?>/g

function computeLineCol(code: string, index: number): { line: number; column: number } {
  let line = 1
  let lastNewlineIndex = -1

  for (let i = 0; i < index; i++) {
    if (code.charCodeAt(i) === 10 /* \n */) {
      line++
      lastNewlineIndex = i
    }
  }

  return { line, column: index - lastNewlineIndex }
}

/**
 * Stamps every element inside a Vue SFC's <template> block with a
 * `data-kapi-loc="relativeFile:line:column"` attribute, computed from the
 * raw source text before @vitejs/plugin-vue compiles the template away.
 */
export function stampTemplateLocations(code: string, relativeFile: string): string {
  const templateOpenMatch = code.match(/<template\b[^>]*>/)
  if (!templateOpenMatch || templateOpenMatch.index === undefined) return code

  const templateContentStart = templateOpenMatch.index + templateOpenMatch[0].length
  const templateCloseIndex = code.lastIndexOf('</template>')
  if (templateCloseIndex === -1 || templateCloseIndex <= templateContentStart) return code

  let result = ''
  let cursor = 0
  TAG_RE.lastIndex = templateContentStart

  let match: RegExpExecArray | null
  while ((match = TAG_RE.exec(code))) {
    if (match.index >= templateCloseIndex) break

    const tagName = match[1]
    const isRootTemplateTag = match.index === templateOpenMatch.index
    if (tagName.toLowerCase() === 'template' && isRootTemplateTag) continue

    const { line, column } = computeLineCol(code, match.index)
    const tagNameEnd = match.index + 1 + tagName.length
    const insertion = ` data-kapi-loc="${relativeFile}:${line}:${column}"`

    result += code.slice(cursor, tagNameEnd) + insertion
    cursor = tagNameEnd
  }

  result += code.slice(cursor)
  return result
}
