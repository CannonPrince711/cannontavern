/**
 * Incremental parsers for streamed HTTP responses. Feed raw text chunks in any
 * split; complete events come out.
 */

export interface SseEvent {
  event: string
  data: string
  id?: string
}

/** Server-Sent Events (text/event-stream). */
export class SseParser {
  private buffer = ''
  private data: string[] = []
  private event = ''
  private id: string | undefined

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk
    const out: SseEvent[] = []
    let nl: number
    while ((nl = this.buffer.search(/\r\n|\r|\n/)) !== -1) {
      const line = this.buffer.slice(0, nl)
      const sepLen = this.buffer.startsWith('\r\n', nl) ? 2 : 1
      this.buffer = this.buffer.slice(nl + sepLen)
      const ev = this.line(line)
      if (ev) out.push(ev)
    }
    return out
  }

  /** Flushes a final event that wasn't followed by a blank line. */
  end(): SseEvent[] {
    const out: SseEvent[] = []
    if (this.buffer) {
      const ev = this.line(this.buffer)
      this.buffer = ''
      if (ev) out.push(ev)
    }
    const last = this.dispatch()
    if (last) out.push(last)
    return out
  }

  private line(line: string): SseEvent | null {
    if (line === '') return this.dispatch()
    if (line.startsWith(':')) return null
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') this.data.push(value)
    else if (field === 'event') this.event = value
    else if (field === 'id') this.id = value
    return null
  }

  private dispatch(): SseEvent | null {
    if (this.data.length === 0) {
      this.event = ''
      return null
    }
    const ev: SseEvent = { event: this.event || 'message', data: this.data.join('\n'), id: this.id }
    this.data = []
    this.event = ''
    return ev
  }
}

/** Newline-delimited JSON (Ollama and friends). Invalid lines are reported, not thrown. */
export class NdjsonParser {
  private buffer = ''

  feed(chunk: string): { values: unknown[]; errors: string[] } {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    return this.parse(lines)
  }

  end(): { values: unknown[]; errors: string[] } {
    const rest = this.buffer
    this.buffer = ''
    return this.parse([rest])
  }

  private parse(lines: string[]): { values: unknown[]; errors: string[] } {
    const values: unknown[] = []
    const errors: string[] = []
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      try {
        values.push(JSON.parse(t))
      } catch {
        errors.push(t.slice(0, 200))
      }
    }
    return { values, errors }
  }
}
