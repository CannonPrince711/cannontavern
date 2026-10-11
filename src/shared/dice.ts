/**
 * Dice expressions:
 *   d20, 1d20+5, 2d6+1d4-1, 4d6kh3, 4d6dl1, 2d20kl1, d%, 1d20 adv, 1d20+3 dis Stealth
 * Terms are summed; "kh"/"kl" keep the highest/lowest N, "dh"/"dl" drop them.
 * "adv"/"dis" (or "advantage"/"disadvantage") roll a lone d20 twice and keep
 * the higher/lower. Anything after the expression is the label.
 */
import type { DieResult, RollMode, RollResult } from './types'

export type Rng = () => number

/** Uniform float in [0, 1) from the platform's CSPRNG. */
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buf)
  return buf[0]! / 2 ** 32
}

interface DiceTerm {
  kind: 'dice'
  sign: 1 | -1
  count: number
  sides: number
  keep?: { mode: 'kh' | 'kl' | 'dh' | 'dl'; n: number }
}

interface ConstTerm {
  kind: 'const'
  sign: 1 | -1
  value: number
}

type Term = DiceTerm | ConstTerm

export interface ParsedRoll {
  terms: Term[]
  mode: RollMode
  label: string
  /** Normalised expression, e.g. "1d20+5". */
  expression: string
}

export class DiceError extends Error {}

const TERM_RE = /^(\d*)d(\d+|%)(?:(kh|kl|dh|dl|k)(\d+))?$/i

export function parseRoll(input: string): ParsedRoll {
  let src = input.trim()
  if (!src) throw new DiceError('Nothing to roll. Try 1d20+5 or 4d6kh3.')

  let mode: RollMode = 'normal'
  // The expression is the leading run of dice-ish tokens ("1d20", "+", "5");
  // the remaining words are flags (adv/dis) and the label.
  const tokens = src.split(/\s+/)
  let i = 0
  while (i < tokens.length && /^[0-9d%+\-khl]+$/i.test(tokens[i]!) && !/^[khl]+$/i.test(tokens[i]!)) i++
  let expr = tokens.slice(0, i).join('')
  const labelWords: string[] = []
  for (const w of tokens.slice(i)) {
    if (/^(adv|advantage)$/i.test(w)) mode = 'adv'
    else if (/^(dis|disadv|disadvantage)$/i.test(w)) mode = 'dis'
    else labelWords.push(w)
  }
  const rest = labelWords.join(' ')
  // "2x6" or "1d20+" are typos, not labels.
  if (!expr && /\d/.test(tokens[0] ?? '')) throw new DiceError(`“${tokens[0]}” isn’t a dice expression. Use forms like 2d6, d20+3, 4d6kh3.`)
  if (!expr) {
    // "/roll adv" or "/roll Stealth" means a plain d20.
    expr = 'd20'
  }
  src = expr

  const terms: Term[] = []
  const parts = src.match(/[+-]?[^+-]+/g)
  if (!parts) throw new DiceError(`Can't read “${input}”.`)
  for (const raw of parts) {
    const sign: 1 | -1 = raw.startsWith('-') ? -1 : 1
    const body = raw.replace(/^[+-]/, '').toLowerCase()
    if (/^\d+$/.test(body)) {
      terms.push({ kind: 'const', sign, value: Number(body) })
      continue
    }
    const t = TERM_RE.exec(body)
    if (!t) throw new DiceError(`“${raw}” isn’t a dice term. Use forms like 2d6, d20, 4d6kh3.`)
    const count = t[1] ? Number(t[1]) : 1
    const sides = t[2] === '%' ? 100 : Number(t[2])
    if (count < 1 || count > 100) throw new DiceError('Roll between 1 and 100 dice per term.')
    if (sides < 2 || sides > 1000) throw new DiceError('Dice need between 2 and 1000 sides.')
    const term: DiceTerm = { kind: 'dice', sign, count, sides }
    if (t[3]) {
      const keepMode = (t[3].toLowerCase() === 'k' ? 'kh' : t[3].toLowerCase()) as 'kh' | 'kl' | 'dh' | 'dl'
      const n = Number(t[4])
      if (n < 0 || n > count) throw new DiceError(`Can't keep or drop ${n} of ${count} dice.`)
      term.keep = { mode: keepMode, n }
    }
    terms.push(term)
  }

  // Advantage applies to a single plain d20 term.
  if (mode !== 'normal') {
    const d20 = terms.find((t): t is DiceTerm => t.kind === 'dice' && t.sides === 20 && t.count === 1 && !t.keep)
    if (!d20) throw new DiceError('Advantage and disadvantage need a single d20, e.g. 1d20+4 adv.')
    d20.count = 2
    d20.keep = { mode: mode === 'adv' ? 'kh' : 'kl', n: 1 }
  }

  return { terms, mode, label: rest, expression: formatExpression(terms, mode) }
}

function formatExpression(terms: Term[], mode: RollMode): string {
  return terms
    .map((t, i) => {
      const sign = t.sign < 0 ? '-' : i === 0 ? '' : '+'
      if (t.kind === 'const') return `${sign}${t.value}`
      // Show advantage as "1d20" (the mode is reported separately).
      if (mode !== 'normal' && t.sides === 20 && t.count === 2 && t.keep?.n === 1) return `${sign}1d20`
      const keep = t.keep ? `${t.keep.mode}${t.keep.n}` : ''
      return `${sign}${t.count}d${t.sides}${keep}`
    })
    .join('')
}

function rollDie(sides: number, rng: Rng): number {
  return Math.floor(rng() * sides) + 1
}

export function roll(input: string, rng: Rng = cryptoRng): RollResult {
  const parsed = parseRoll(input)
  const dice: DieResult[] = []
  let total = 0
  let modifier = 0
  let naturalD20: number | null = null
  let d20Terms = 0

  for (const t of parsed.terms) {
    if (t.kind === 'const') {
      modifier += t.sign * t.value
      total += t.sign * t.value
      continue
    }
    const values = Array.from({ length: t.count }, () => rollDie(t.sides, rng))
    const kept = new Array<boolean>(values.length).fill(true)
    if (t.keep) {
      const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i)
      const { mode, n } = t.keep
      const dropIdx =
        mode === 'kh' ? order.slice(0, values.length - n) : mode === 'kl' ? order.slice(n) : mode === 'dh' ? order.slice(values.length - n) : order.slice(0, n)
      for (const { i } of dropIdx) kept[i] = false
    }
    values.forEach((v, i) => {
      dice.push({ sides: t.sides, value: v, kept: kept[i]! })
      if (kept[i]) total += t.sign * v
    })
    if (t.sides === 20) {
      d20Terms++
      const keptD20 = values.filter((_, i) => kept[i])
      if (keptD20.length === 1) naturalD20 = keptD20[0]!
    }
  }

  const single = d20Terms === 1 && naturalD20 !== null
  return {
    expression: parsed.expression,
    ...(parsed.label ? { label: parsed.label } : {}),
    mode: parsed.mode,
    dice,
    modifier,
    total,
    crit: single && naturalD20 === 20,
    fumble: single && naturalD20 === 1
  }
}

/** "**1d20+5** → ⟨14⟩ + 5 = **19** · DC 15 ✓" — the text stored in the roll callout. */
export function formatRoll(r: RollResult): string {
  const dice = r.dice.map((d) => (d.kept ? `⟨${d.value}⟩` : `~~${d.value}~~`)).join(' ')
  const mod = r.modifier ? ` ${r.modifier > 0 ? '+' : '−'} ${Math.abs(r.modifier)}` : ''
  const mode = r.mode === 'adv' ? ' (advantage)' : r.mode === 'dis' ? ' (disadvantage)' : ''
  const flags = r.crit ? ' · natural 20!' : r.fumble ? ' · natural 1' : ''
  const dc = r.dc !== undefined ? ` · DC ${r.dc} ${r.success ? '✓ success' : '✗ failure'}` : ''
  return `**${r.expression}**${mode} → ${dice}${mod} = **${r.total}**${flags}${dc}`
}
