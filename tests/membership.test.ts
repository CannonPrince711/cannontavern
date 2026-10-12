import { describe, expect, it } from 'vitest'
import { campaignFolderFromLink, campaignLink, forCampaign, fromOtherCampaigns, inCampaign } from '../src/shared/membership'

const ROOT = 'DND Tavern'
const FROST = 'DND Tavern/Campaigns/Frostborn'
const TRIAD = 'DND Tavern/Campaigns/Triad Accord'

describe('campaign membership', () => {
  it('reads campaign folders from links in any form', () => {
    expect(campaignFolderFromLink('[[DND Tavern/Campaigns/Frostborn/Campaign|Frostborn]]', ROOT)).toBe(FROST)
    expect(campaignFolderFromLink('Campaigns/Frostborn/Campaign', ROOT)).toBe(FROST)
    expect(campaignFolderFromLink('[[Frostborn]]', ROOT)).toBe(FROST)
    expect(campaignFolderFromLink('', ROOT)).toBeNull()
  })

  it('writes a link that reads back to the same folder', () => {
    const link = campaignLink(TRIAD, 'Triad Accord')
    expect(link).toBe('[[DND Tavern/Campaigns/Triad Accord/Campaign|Triad Accord]]')
    expect(campaignFolderFromLink(link, ROOT)).toBe(TRIAD)
  })

  it('keeps each campaign to its own characters, plus ones in no campaign', () => {
    const list = [
      { name: 'Lyrian', campaigns: [FROST] },
      { name: 'Damian', campaigns: [TRIAD] },
      { name: 'Both', campaigns: [TRIAD, FROST.toUpperCase()] },
      { name: 'Free' }
    ]
    expect(forCampaign(list, FROST).map((c) => c.name)).toEqual(['Lyrian', 'Both', 'Free'])
    expect(fromOtherCampaigns(list, FROST).map((c) => c.name)).toEqual(['Damian'])
    expect(forCampaign(list, null)).toHaveLength(4)
    expect(inCampaign({ campaigns: [] }, FROST)).toBe(true)
  })
})
