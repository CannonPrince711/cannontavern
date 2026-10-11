import { describe, expect, it } from 'vitest'
import { isInsecureUrl, isPrivateHost } from '@shared/net'
import { NdjsonParser, SseParser } from '@shared/streams'
import { getByPath, parseJsonPath, renderTemplate } from '@shared/template'

describe('renderTemplate', () => {
  const vars = {
    system: 'Be "nice"\nalways',
    messages_json: [{ role: 'user', content: 'hi' }],
    prompt: 'line1\nline2 "q"',
    model: 'm',
    max_tokens: 100,
    temperature: 0.7
  }

  it('produces valid JSON from a typical template', () => {
    const out = renderTemplate(
      '{"model":"{{model}}","system":"{{system}}","messages":{{messages_json}},"max_tokens":{{max_tokens}},"temperature":{{temperature}},"prompt":"{{ prompt }}"}',
      vars
    )
    expect(JSON.parse(out)).toEqual({
      model: 'm',
      system: 'Be "nice"\nalways',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
      temperature: 0.7,
      prompt: 'line1\nline2 "q"'
    })
  })

  it('leaves unknown placeholders visible', () => {
    expect(renderTemplate('{{nope}}', vars)).toBe('{{nope}}')
  })
})

describe('JSONPath', () => {
  const obj = { choices: [{ message: { content: 'hello' } }], 'a b': [1, 2, 3] }

  it('parses dotted, indexed and quoted paths', () => {
    expect(parseJsonPath('$.choices[0].message.content')).toEqual(['choices', 0, 'message', 'content'])
    expect(parseJsonPath("$['a b'][2]")).toEqual(['a b', 2])
    expect(parseJsonPath('choices[0].text')).toEqual(['choices', 0, 'text'])
  })

  it('reads values and returns undefined for missing steps', () => {
    expect(getByPath(obj, '$.choices[0].message.content')).toBe('hello')
    expect(getByPath(obj, "$['a b'][-1]")).toBe(3)
    expect(getByPath(obj, '$.choices[3].message')).toBeUndefined()
    expect(getByPath(obj, '$.nope.deeper')).toBeUndefined()
  })

  it('rejects malformed paths', () => {
    expect(() => parseJsonPath('$.a[')).toThrow()
    expect(() => parseJsonPath('$..a')).toThrow()
  })
})

describe('SseParser', () => {
  it('handles events split across arbitrary chunks', () => {
    const p = new SseParser()
    const text = 'event: message_start\ndata: {"a":1}\n\n: comment\ndata: line1\ndata: line2\n\ndata: [DONE]\n\n'
    const events = []
    for (let i = 0; i < text.length; i += 3) events.push(...p.feed(text.slice(i, i + 3)))
    events.push(...p.end())
    expect(events).toEqual([
      { event: 'message_start', data: '{"a":1}', id: undefined },
      { event: 'message', data: 'line1\nline2', id: undefined },
      { event: 'message', data: '[DONE]', id: undefined }
    ])
  })

  it('accepts CRLF and flushes a trailing event without a blank line', () => {
    const p = new SseParser()
    expect(p.feed('data: x\r\n\r\ndata: y')).toEqual([{ event: 'message', data: 'x', id: undefined }])
    expect(p.end()).toEqual([{ event: 'message', data: 'y', id: undefined }])
  })
})

describe('NdjsonParser', () => {
  it('parses split lines and reports bad ones', () => {
    const p = new NdjsonParser()
    const a = p.feed('{"a":1}\n{"b"')
    const b = p.feed(':2}\nnot json\n')
    const c = p.end()
    expect([...a.values, ...b.values, ...c.values]).toEqual([{ a: 1 }, { b: 2 }])
    expect(b.errors).toEqual(['not json'])
  })
})

describe('insecure URL warning', () => {
  it('warns for plain http to public hosts', () => {
    expect(isInsecureUrl('http://example.com/v1')).toBe(true)
    expect(isInsecureUrl('http://203.0.113.5:8080')).toBe(true)
  })
  it('does not warn for https, localhost, LAN or Tailscale', () => {
    expect(isInsecureUrl('https://example.com')).toBe(false)
    expect(isInsecureUrl('http://localhost:11434')).toBe(false)
    expect(isInsecureUrl('http://127.0.0.1:5001')).toBe(false)
    expect(isInsecureUrl('http://192.168.1.20:8188')).toBe(false)
    expect(isInsecureUrl('http://10.0.0.5')).toBe(false)
    expect(isInsecureUrl('http://172.20.1.1')).toBe(false)
    expect(isInsecureUrl('http://100.101.102.103:11434')).toBe(false)
    expect(isInsecureUrl('http://gpu-box.tail1234.ts.net:8188')).toBe(false)
    expect(isInsecureUrl('http://[fd7a:115c:a1e0::1]:11434')).toBe(false)
    expect(isInsecureUrl('http://gpubox:5000')).toBe(false)
  })
  it('treats 172.32.x and 100.128.x as public', () => {
    expect(isPrivateHost('172.32.0.1')).toBe(false)
    expect(isPrivateHost('100.128.0.1')).toBe(false)
  })
})
