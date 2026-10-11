// Renders build/icon.svg to the PNG and multi-size ICO files the app needs.
// Run with `npm run icon` after changing the SVG; the outputs are committed.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = await readFile(join(root, 'build/icon.svg'))

const render = (size) => sharp(svg, { density: Math.ceil((72 * size) / 512) * 2 }).resize(size, size).png().toBuffer()

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(sizes.map(render))

await mkdir(join(root, 'resources'), { recursive: true })
await writeFile(join(root, 'build/icon.png'), await render(512))
await writeFile(join(root, 'resources/icon.png'), await render(256))
await writeFile(join(root, 'build/icon.ico'), await pngToIco(pngs))
console.log('Wrote build/icon.png, build/icon.ico, resources/icon.png')
