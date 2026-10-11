import { z } from 'zod'
import { PIN_KINDS } from '@shared/map'
import { handle } from '../ipc'
import { imageService } from '../images'
import { campaignImages, importMapImage, readMap, saveMap } from '../maps'
import { vaultService } from '../vault/service'

const path = z.string().min(1).max(1024)
const coord = z.number().min(0).max(1)

export function registerMapHandlers(): void {
  handle('maps:get', (_e, campaignPath) => readMap(vaultService.require(), campaignPath), z.tuple([path]))

  handle(
    'maps:save',
    (_e, campaignPath, map) => saveMap(vaultService.require(), campaignPath, map),
    z.tuple([
      path,
      z.object({
        image: z.string().max(1024),
        pins: z
          .array(
            z.object({
              id: z.string().max(60),
              name: z.string().max(200),
              x: coord.nullable(),
              y: coord.nullable(),
              kind: z.enum(PIN_KINDS),
              description: z.string().max(4000),
              note: z.string().max(300).optional()
            })
          )
          .max(500),
        party: z.object({ x: coord, y: coord, at: z.string().max(60).optional() }).nullable()
      })
    ])
  )

  handle('maps:importImage', (_e, campaignPath) => importMapImage(vaultService.require(), campaignPath), z.tuple([path]))
  handle('maps:images', (_e, campaignPath) => campaignImages(vaultService.require(), campaignPath), z.tuple([path]))
  handle('maps:generate', (_e, campaignPath, extra) => imageService.generateMap(campaignPath, extra), z.tuple([path, z.string().max(1000).optional()]))
}
