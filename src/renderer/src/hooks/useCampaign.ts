import { useCallback, useEffect, useState } from 'react'
import type { Campaign, Party } from '@shared/types'
import { invoke, on } from '@/lib/ipc'

/** Loads a campaign's Campaign.md and Party.md, refreshing when either changes on disk. */
export function useCampaign(path: string | null): {
  campaign: Campaign | null
  party: Party | null
  reload: () => void
  setCampaign: (c: Campaign) => void
} {
  const [data, setData] = useState<{ campaign: Campaign; party: Party } | null>(null)

  const reload = useCallback(() => {
    if (!path) return setData(null)
    invoke('campaigns:get', path)
      .then(setData)
      .catch(() => setData(null))
  }, [path])

  useEffect(reload, [reload])
  useEffect(() => {
    if (!path) return
    return on('vault:changed', (e) => {
      if (e.path.startsWith(`${path}/`) && /\/(Campaign|Party)\.md$/i.test(e.path)) reload()
    })
  }, [path, reload])

  return {
    campaign: data?.campaign ?? null,
    party: data?.party ?? null,
    reload,
    setCampaign: (campaign) => setData((d) => (d ? { ...d, campaign } : d))
  }
}
