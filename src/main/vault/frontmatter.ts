import { Document, isMap, parseDocument } from 'yaml'

export interface ParsedNote {
  data: Record<string, unknown>
  body: string
  /** The raw YAML between the --- fences, or null when the note has none. */
  yaml: string | null
}

const STRINGIFY = { lineWidth: 0, minContentWidth: 0 } as const

/**
 * Splits a note into frontmatter and body. The body is everything after the
 * closing fence's line break, byte for byte, so parse → serialize is lossless.
 */
export function splitNote(content: string): { yaml: string | null; body: string } {
  const text = content.startsWith('﻿') ? content.slice(1) : content
  if (!/^---[ \t]*\r?\n/.test(text)) return { yaml: null, body: text }
  const lines = text.split(/(?<=\n)/)
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*\r?\n?$/.test(lines[i] ?? '')) {
      return { yaml: lines.slice(1, i).join(''), body: lines.slice(i + 1).join('') }
    }
  }
  return { yaml: null, body: text }
}

export function parseNote(content: string): ParsedNote {
  const { yaml, body } = splitNote(content)
  if (yaml === null) return { data: {}, body, yaml: null }
  const doc = parseDocument(yaml)
  const js: unknown = doc.errors.length ? {} : doc.toJS()
  const data = js && typeof js === 'object' && !Array.isArray(js) ? (js as Record<string, unknown>) : {}
  return { data, body, yaml }
}

/** Writes a brand-new note. */
export function serializeNote(data: Record<string, unknown>, body: string): string {
  const clean = stripUndefined(data)
  if (Object.keys(clean).length === 0) return body
  const doc = new Document(clean)
  return `---\n${doc.toString(STRINGIFY)}---\n${body}`
}

/**
 * Applies a frontmatter patch to an existing note without disturbing anything
 * else: untouched keys keep their formatting, order and comments, and keys the
 * user added in Obsidian survive. `undefined` deletes a key. When nothing
 * changes, the original string is returned unchanged.
 */
export function updateNote(content: string, patch: Record<string, unknown>, body?: string): string {
  const split = splitNote(content)
  const nextBody = body ?? split.body
  const doc = split.yaml !== null ? parseDocument(split.yaml) : new Document({})
  if (doc.errors.length) {
    throw new Error(`Frontmatter is not valid YAML: ${doc.errors[0]?.message ?? 'parse error'}`)
  }
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as typeof doc.contents

  const currentData = (doc.toJS() ?? {}) as Record<string, unknown>
  let changed = false
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      if (doc.has(key)) {
        doc.delete(key)
        changed = true
      }
      continue
    }
    if (!deepEqual(currentData[key], value)) {
      doc.set(key, doc.createNode(stripUndefinedDeep(value)))
      changed = true
    }
  }

  if (!changed && nextBody === split.body) return content
  const map = doc.contents
  const empty = isMap(map) && map.items.length === 0
  if (empty) return nextBody
  const yaml = changed || split.yaml === null ? doc.toString(STRINGIFY) : split.yaml
  return `---\n${yaml}---\n${nextBody}`
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return stripUndefinedDeep(obj) as Record<string, unknown>
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = stripUndefinedDeep(v)
    return out
  }
  return value
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>
    const bo = stripUndefined(b as Record<string, unknown>)
    const ak = Object.keys(ao).filter((k) => ao[k] !== undefined)
    const bk = Object.keys(bo)
    if (ak.length !== bk.length) return false
    return ak.every((k) => deepEqual(ao[k], bo[k]))
  }
  return false
}
