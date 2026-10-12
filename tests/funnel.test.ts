import { describe, expect, it } from 'vitest'
import { enableLink } from '../src/main/table/funnel'

describe('Tailscale Funnel', () => {
  it('finds the link Tailscale prints when Funnel still has to be allowed', () => {
    const out = 'Funnel is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/funnel?node=nXYZ123CNTRL\n'
    expect(enableLink(out)).toBe('https://login.tailscale.com/f/funnel?node=nXYZ123CNTRL')
    expect(enableLink('Available on the internet:\nhttps://seth.tailf47d02.ts.net/\n|-- proxy http://127.0.0.1:7777')).toBeNull()
  })
})
