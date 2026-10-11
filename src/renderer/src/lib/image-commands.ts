/** /image commands. Imported for its side effects. */
import { registerCommand } from './commands'
import { useImages } from '@/stores/images'
import { useVault } from '@/stores/vault'

registerCommand({
  name: 'image',
  usage: '/image <prompt> | scene | portrait [name]',
  description: 'Generate an image: describe it, illustrate the scene, or paint a portrait',
  run: async ({ session, args }) => {
    const [first, ...rest] = args.trim().split(/\s+/)
    const generate = useImages.getState().generate
    if (!first || first.toLowerCase() === 'scene') {
      await generate({ sessionPath: session.path, kind: 'scene', prompt: rest.join(' ') || undefined })
      return
    }
    if (first.toLowerCase() === 'portrait') {
      const name = rest.join(' ').trim().toLowerCase()
      const index = useVault.getState().index
      const character = name ? index?.characters.concat(index.npcs).find((c) => c.displayName.toLowerCase().startsWith(name) || c.name.toLowerCase().startsWith(name)) : undefined
      if (name && !character) throw new Error(`No character called “${rest.join(' ')}”.`)
      await generate({ sessionPath: session.path, kind: 'portrait', characterPath: character?.path })
      return
    }
    await generate({ sessionPath: session.path, kind: 'prompt', prompt: args.trim() })
  }
})
