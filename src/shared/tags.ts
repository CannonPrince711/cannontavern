/** "a, b, c" → ["a", "b", "c"] (empty and duplicate tags dropped). */
export function splitTags(prompt: string): string[] {
  const seen = new Set<string>()
  return prompt
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
}
