/**
 * Which campaigns a character belongs to. A character note can list them in
 * its `campaigns` frontmatter (wikilinks to Campaign.md); one that doesn't is
 * counted in every campaign whose sessions it plays in. A character in no
 * campaign at all is free to turn up in any of them.
 */
import { CAMPAIGN_FILE, FOLDERS } from './layout'
import { joinVaultPath, toWikilink, wikilinkTarget } from './names'

/** "[[DND Tavern/Campaigns/Frost/Campaign|Frost]]", "Campaigns/Frost" or "Frost" → the campaign folder. */
export function campaignFolderFromLink(link: string, rootFolder: string): string | null {
  const target = wikilinkTarget(link).replace(/\.md$/i, '')
  if (!target) return null
  const parts = joinVaultPath(target).split('/')
  const i = parts.findIndex((p) => p.toLowerCase() === FOLDERS.campaigns.toLowerCase())
  if (i > 0 && parts[i + 1]) return joinVaultPath(...parts.slice(0, i + 2))
  if (i === 0 && parts[1]) return joinVaultPath(rootFolder, FOLDERS.campaigns, parts[1])
  if (i === -1) return joinVaultPath(rootFolder, FOLDERS.campaigns, parts[0]!)
  return null
}

/** The frontmatter link for a campaign folder. */
export function campaignLink(folder: string, name?: string): string {
  return toWikilink(joinVaultPath(folder, CAMPAIGN_FILE), { full: true, alias: name ?? folder.split('/').pop() })
}

/** True when the character shows up in the campaign (no campaign open: everyone does). */
export function inCampaign(c: { campaigns?: string[] }, campaignPath: string | null | undefined): boolean {
  if (!campaignPath || !c.campaigns?.length) return true
  const want = campaignPath.toLowerCase()
  return c.campaigns.some((f) => f.toLowerCase() === want)
}

/** Keeps the characters that show up in the campaign. */
export function forCampaign<T extends { campaigns?: string[] }>(list: T[], campaignPath: string | null | undefined): T[] {
  return campaignPath ? list.filter((c) => inCampaign(c, campaignPath)) : list
}

/** Characters from other campaigns only (for importing). */
export function fromOtherCampaigns<T extends { campaigns?: string[] }>(list: T[], campaignPath: string | null | undefined): T[] {
  return list.filter((c) => !inCampaign(c, campaignPath))
}
