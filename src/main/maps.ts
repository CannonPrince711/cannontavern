/** Campaign map notes: read, save, image import and AI map generation. */
import { dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, extname } from 'node:path'
import { IMAGE_EXTENSIONS, CAMPAIGN_FILE, IMAGES_FOLDER } from '@shared/layout'
import { DEFAULT_ASPECT, normalizeAspect, normalizeParty, normalizePins, normalizeScale, pinsFromBody, replacePinsSection, type CampaignMap, type MapPin, type MapScale, type PartyMarker } from '@shared/map'
import { joinVaultPath, noteName, sanitizeFileName, toWikilink } from '@shared/names'
import type { VaultPath } from '@shared/types'
import { AppError } from './errors'
import { parseNote, serializeNote, updateNote } from './vault/frontmatter'
import type { Vault } from './vault/vault'
import { getMainWindow } from './window'
import { resourceImages } from './resources'

/** The campaign's map note: the first "type: map" note in its folder, or where a new one would go. */
async function findMapNote(vault: Vault, campaignPath: VaultPath): Promise<{ path: VaultPath; content: string | null }> {
  const entries = await vault.list(campaignPath).catch(() => [])
  for (const e of entries) {
    if (e.isDir || !e.name.toLowerCase().endsWith('.md') || e.name === CAMPAIGN_FILE) continue
    const file = await vault.readIfExists(e.path)
    if (file && parseNote(file.content).data.type === 'map') return { path: e.path, content: file.content }
  }
  return { path: joinVaultPath(campaignPath, `${sanitizeFileName(noteName(campaignPath))} Map.md`), content: null }
}

/**
 * Resolves the stored image reference: a bare file name (in the campaign's
 * Images folder), a path relative to the campaign folder, or a vault path.
 */
function imagePath(vault: Vault, campaignPath: VaultPath, raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const v = raw.trim().replace(/^!?\[\[|\]\]$/g, '').split('|')[0]!.trim()
  if (!v) return ''
  if (!v.includes('/')) return joinVaultPath(campaignPath, IMAGES_FOLDER, v)
  return v.startsWith(`${vault.rootFolder}/`) ? v : joinVaultPath(campaignPath, v)
}

export async function readMap(vault: Vault, campaignPath: VaultPath): Promise<CampaignMap> {
  const { path, content } = await findMapNote(vault, campaignPath)
  if (content === null) return { path, exists: false, image: '', pins: [], party: null, aspect: DEFAULT_ASPECT, scale: null }
  const { data, body } = parseNote(content)
  let pins = normalizePins(data.pins)
  // Hand-written notes list pins in the body; offer them for placing.
  if (!pins.length) pins = pinsFromBody(body)
  return { path, exists: true, image: imagePath(vault, campaignPath, data.image), pins, party: normalizeParty(data.party), aspect: normalizeAspect(data.aspect), scale: normalizeScale(data.scale) }
}

/** Four decimals is well under a pixel on any map. */
function round(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10000) / 10000
}

export async function saveMap(
  vault: Vault,
  campaignPath: VaultPath,
  next: { image: string; pins: MapPin[]; party: PartyMarker | null; aspect?: number; scale?: MapScale | null }
): Promise<CampaignMap> {
  const { path } = await findMapNote(vault, campaignPath)
  // Store the image relative to the campaign folder when it's inside it.
  const image = next.image.startsWith(`${campaignPath}/`) ? next.image.slice(campaignPath.length + 1) : next.image
  const fields = {
    pins: next.pins.map((p) => ({ id: p.id, name: p.name, x: round(p.x), y: round(p.y), kind: p.kind, ...(p.description ? { description: p.description } : {}), ...(p.note ? { note: p.note } : {}) })),
    party: next.party ? { ...next.party, x: round(next.party.x)!, y: round(next.party.y)! } : null,
    image: image || undefined,
    aspect: next.aspect && Math.abs(next.aspect - DEFAULT_ASPECT) > 0.001 ? Math.round(next.aspect * 10000) / 10000 : undefined,
    scale: next.scale ?? undefined
  }
  const embed = next.image ? `![[${next.image.split('/').pop()}]]` : ''
  await vault.mutate(path, (cur) => {
    if (cur === null) {
      const name = noteName(campaignPath)
      const body = replacePinsSection(`\n# ${name} map\n\n${embed}\n`, next.pins)
      return serializeNote({ type: 'map', campaign: toWikilink(joinVaultPath(campaignPath, CAMPAIGN_FILE), { full: true, alias: name }), ...fields }, body)
    }
    let body = parseNote(cur).body
    if (embed && !body.includes(embed)) body = body.replace(/^(#[^\n]*\n)/m, `$1\n${embed}\n`)
    if (embed && !body.includes(embed)) body = `\n${embed}\n${body}`
    return updateNote(cur, fields, replacePinsSection(body, next.pins))
  })
  return readMap(vault, campaignPath)
}

/** Copies an image the user picks into the campaign's Images folder. */
export async function importMapImage(vault: Vault, campaignPath: VaultPath): Promise<string | null> {
  const win = getMainWindow()
  const opts: Electron.OpenDialogOptions = { title: 'Choose a map image', properties: ['openFile'], filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }] }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  const file = r.canceled ? null : r.filePaths[0]
  if (!file) return null
  const ext = extname(file).slice(1).toLowerCase()
  if (!IMAGE_EXTENSIONS.includes(ext)) throw new AppError('BAD_IMAGE', 'Choose a PNG, JPEG, WebP or GIF image.')
  const data = await fs.readFile(file)
  const dir = joinVaultPath(campaignPath, IMAGES_FOLDER)
  await vault.mkdir(dir)
  const dest = await vault.uniquePath(dir, sanitizeFileName(basename(file, extname(file))) || 'map', `.${ext}`)
  await vault.writeBinary(dest, data)
  return dest
}

/** Asks for a sketch to turn into a map; null when cancelled. */
export async function pickSketch(): Promise<{ data: Buffer; filename: string } | null> {
  const win = getMainWindow()
  const opts: Electron.OpenDialogOptions = { title: 'Choose a map sketch', properties: ['openFile'], filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }] }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  const file = r.canceled ? null : r.filePaths[0]
  if (!file) return null
  if (!IMAGE_EXTENSIONS.includes(extname(file).slice(1).toLowerCase())) throw new AppError('BAD_IMAGE', 'Choose a PNG, JPEG, WebP or GIF image.')
  return { data: await fs.readFile(file), filename: basename(file) }
}

const isImage = (name: string): boolean => IMAGE_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '')

/** Images in the campaign's Images folder, then the shared ones in Resources/Images. */
export async function campaignImages(vault: Vault, campaignPath: VaultPath): Promise<string[]> {
  const dir = joinVaultPath(campaignPath, IMAGES_FOLDER)
  const entries = await vault.list(dir).catch(() => [])
  const own = entries.filter((e) => !e.isDir && isImage(e.name)).map((e) => e.path)
  return [...own, ...(await resourceImages(vault, isImage))]
}
