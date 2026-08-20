// Pure helpers for the .tsi fence checker (see ../check-docs.mjs).
// Conventions (first line of a fence body):
//   // not-checked          skip the fence (deliberately invalid samples)
//   // <dir/>name.tsi|.ts   write the fence as that basename (files in one page share a directory)
//   (no comment, tsi)       snippet-<n>.tsi where n is the fence's index on the page
//   (no comment, ts)        skipped — plain TS only matters as an import target
//   nola.config.*           skipped — the config is validated by the runtime, not tsc

const FENCE_OPEN = /^(`{3,})([\w-]*)[^`]*$/
const FILE_COMMENT = /^\/\/\s*(?:[\w.-]+\/)*([\w.-]+\.(?:tsi|ts))\s*$/
const NOT_CHECKED = /^\/\/\s*not-checked\b/

/** @returns {{ lang: string, body: string, line: number }[]} */
export function extractFences(markdown) {
  const lines = markdown.split('\n')
  const fences = []
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i])
    if (!open) continue
    const ticks = open[1]
    const lang = open[2]
    const start = i + 1
    let j = start
    while (j < lines.length && !(lines[j].startsWith(ticks) && lines[j].trim() === ticks)) j++
    fences.push({ lang, body: lines.slice(start, j).join('\n'), line: i + 1 })
    i = j
  }
  return fences
}

/** @returns {{ files: { name: string, body: string, fenceLine: number }[], errors: string[] }} */
export function planPageFiles(fences) {
  const files = []
  const errors = []
  const seen = new Map()
  fences.forEach((fence, index) => {
    if (fence.lang !== 'tsi' && fence.lang !== 'ts') return
    const [first = '', ...rest] = fence.body.split('\n')
    if (NOT_CHECKED.test(first.trim())) return
    const named = FILE_COMMENT.exec(first.trim())
    let name
    let body
    if (named) {
      name = named[1]
      body = rest.join('\n')
      if (name.startsWith('nola.config.')) return
    } else {
      if (fence.lang === 'ts') return
      name = `snippet-${index + 1}.tsi`
      body = fence.body
    }
    if (seen.has(name)) {
      errors.push(`duplicate sample file "${name}" (fence at line ${fence.line}; first seen at line ${seen.get(name)})`)
      return
    }
    seen.set(name, fence.line)
    files.push({ name, body, fenceLine: fence.line })
  })
  return { files, errors }
}

/** 'docs/language/ask.mdx' -> 'docs-language-ask' */
export const pageSlug = (relPath) => relPath.replace(/\.(mdx?|md)$/, '').replace(/[\\/]/g, '-')
