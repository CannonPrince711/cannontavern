/**
 * {{placeholder}} templates for "Custom" backends, plus a small JSONPath subset
 * for reading values out of responses.
 */

export type TemplateValue = string | number | boolean | null | undefined | object

/**
 * Renders a body template. Placeholder values are written so the result is
 * valid JSON whether the placeholder sits inside quotes or not:
 *  - names ending in `_json` are inserted as raw JSON (`{{messages_json}}`)
 *  - strings are JSON-escaped without surrounding quotes, so write `"{{prompt}}"`
 *  - numbers and booleans are inserted as-is, so write `{{max_tokens}}` unquoted
 * Unknown placeholders are left untouched so mistakes are visible.
 */
export function renderTemplate(template: string, vars: Record<string, TemplateValue>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, name: string) => {
    if (!(name in vars)) return whole
    const value = vars[name]
    if (name.endsWith('_json')) return JSON.stringify(value ?? null)
    if (value === null || value === undefined) return ''
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (typeof value === 'object') return JSON.stringify(value)
    return JSON.stringify(value).slice(1, -1)
  })
}

type PathToken = string | number

/** Parses "$.choices[0].message.content" / "$['a b'][2]" into tokens. */
export function parseJsonPath(path: string): PathToken[] {
  const src = path.trim()
  if (!src) return []
  let i = src.startsWith('$') ? 1 : 0
  const tokens: PathToken[] = []
  while (i < src.length) {
    const ch = src[i]
    if (ch === '.') {
      i++
      let name = ''
      while (i < src.length && src[i] !== '.' && src[i] !== '[') name += src[i++]
      if (!name) throw new Error(`Invalid JSONPath "${path}": empty name`)
      tokens.push(name)
    } else if (ch === '[') {
      const end = findBracketEnd(src, i)
      const inner = src.slice(i + 1, end).trim()
      if (/^-?\d+$/.test(inner)) tokens.push(Number(inner))
      else if (/^(['"]).*\1$/.test(inner)) tokens.push(inner.slice(1, -1))
      else throw new Error(`Invalid JSONPath "${path}": bad index [${inner}]`)
      i = end + 1
    } else if (tokens.length === 0 && i === 0) {
      // Allow "choices[0].text" without the leading "$.".
      let name = ''
      while (i < src.length && src[i] !== '.' && src[i] !== '[') name += src[i++]
      tokens.push(name)
    } else {
      throw new Error(`Invalid JSONPath "${path}" at position ${i}`)
    }
  }
  return tokens
}

function findBracketEnd(src: string, start: number): number {
  let quote: string | null = null
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i]!
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"') quote = ch
    else if (ch === ']') return i
  }
  throw new Error(`Invalid JSONPath: unclosed [`)
}

/** Reads a value by JSONPath; returns undefined when any step is missing. */
export function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const token of parseJsonPath(path)) {
    if (cur === null || cur === undefined) return undefined
    if (typeof token === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[token < 0 ? cur.length + token : token]
    } else {
      if (typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[token]
    }
  }
  return cur
}
