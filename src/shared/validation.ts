/**
 * Readable messages for rejected IPC arguments, instead of zod's JSON dump:
 * "Premise is too long: 13,200 characters, the limit is 12,000."
 */
import type { z } from 'zod'

const n = (v: number): string => v.toLocaleString('en-US')

/** "houseRules" / "house_rules" → "House rules". */
export function fieldLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'A value'
}

function valueAt(root: unknown, path: PropertyKey[]): unknown {
  let v = root
  for (const k of path) v = v && typeof v === 'object' ? (v as Record<PropertyKey, unknown>)[k] : undefined
  return v
}

/** One sentence per problem (at most three), or null when there's nothing to say. */
export function describeIssues(error: z.ZodError, input: unknown): string | null {
  const lines = error.issues.slice(0, 3).map((issue) => {
    const key = [...issue.path].reverse().find((k): k is string => typeof k === 'string')
    const label = key ? fieldLabel(key) : 'A value'
    const value = valueAt(input, issue.path)
    if (issue.code === 'too_big' && typeof value === 'string') return `${label} is too long: ${n(value.length)} characters, the limit is ${n(Number(issue.maximum))}.`
    if (issue.code === 'too_big' && Array.isArray(value)) return `${label} has too many items: ${n(value.length)}, the limit is ${n(Number(issue.maximum))}.`
    if (issue.code === 'too_small' && typeof value === 'string') return `${label} can’t be empty.`
    return `${label}: ${issue.message}`
  })
  return lines.length ? lines.join(' ') : null
}
