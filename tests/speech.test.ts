import { beforeEach, describe, expect, it, vi } from 'vitest'

const tts = { enabled: true, mode: 'server', baseUrl: 'https://pod-8880.proxy.runpod.net/', model: 'kokoro', voice: '', speed: 1.25 }
const request = vi.fn(async () => ({ res: new Response(new Uint8Array([1, 2, 3])), deadline: { clear: vi.fn() } }))

vi.mock('../src/main/settings-store', () => ({ settingsStore: { get: () => ({ tts }) } }))
vi.mock('../src/main/http', () => ({ request }))

const { synthesize } = await import('../src/main/speech')

describe('speech', () => {
  beforeEach(() => {
    request.mockClear()
    Object.assign(tts, { mode: 'server', baseUrl: 'https://pod-8880.proxy.runpod.net/', voice: '' })
  })

  it('asks the server for an mp3 and returns its bytes', async () => {
    const bytes = await synthesize('The tavern falls silent.')
    expect([...bytes]).toEqual([1, 2, 3])
    const [, req] = request.mock.calls[0] as unknown as [unknown, { url: string; body: string }]
    expect(req.url).toBe('https://pod-8880.proxy.runpod.net/v1/audio/speech')
    expect(JSON.parse(req.body)).toEqual({ model: 'kokoro', input: 'The tavern falls silent.', voice: 'alloy', speed: 1.25, response_format: 'mp3' })
  })

  it('needs a server URL in server mode', async () => {
    tts.baseUrl = '  '
    await expect(synthesize('Hello')).rejects.toMatchObject({ code: 'NO_BASE_URL' })
    expect(request).not.toHaveBeenCalled()
  })

  it('does not call a server when speech uses the computer’s voices', async () => {
    tts.mode = 'system'
    await expect(synthesize('Hello')).rejects.toMatchObject({ code: 'TTS_NOT_SERVER' })
    expect(request).not.toHaveBeenCalled()
  })
})
