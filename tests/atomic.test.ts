import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJson, writeFileAtomic } from '../src/main/atomic'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dnd-tavern-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  it('creates missing folders and writes the content', async () => {
    const file = join(dir, 'a', 'b', 'note.md')
    await writeFileAtomic(file, '# Hello')
    expect(await readFile(file, 'utf8')).toBe('# Hello')
  })

  it('replaces an existing file and leaves no temp files behind', async () => {
    const file = join(dir, 'note.md')
    await writeFileAtomic(file, 'one')
    await writeFileAtomic(file, 'two')
    expect(await readFile(file, 'utf8')).toBe('two')
    expect(await readdir(dir)).toEqual(['note.md'])
  })

  it('survives concurrent writes to the same file', async () => {
    const file = join(dir, 'note.md')
    await Promise.all(Array.from({ length: 10 }, (_, i) => writeFileAtomic(file, `v${i}`)))
    expect(await readFile(file, 'utf8')).toMatch(/^v\d$/)
    expect(await readdir(dir)).toEqual(['note.md'])
  })
})

describe('readJson', () => {
  it('returns undefined for a missing file', async () => {
    expect(await readJson(join(dir, 'missing.json'))).toBeUndefined()
  })

  it('parses JSON', async () => {
    const file = join(dir, 's.json')
    await writeFileAtomic(file, '{"a":1}')
    expect(await readJson(file)).toEqual({ a: 1 })
  })
})
