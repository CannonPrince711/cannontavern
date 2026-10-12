import { dialog, nativeImage } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, extname } from 'node:path'
import { z } from 'zod'
import { FOLDERS, IMAGE_EXTENSIONS } from '@shared/layout'
import { campaignLink } from '@shared/membership'
import { joinVaultPath, sanitizeFileName, toWikilink } from '@shared/names'
import type { CharacterNote, VaultPath } from '@shared/types'
import { AppError, toErrorInfo } from '../errors'
import { handle, send } from '../ipc'
import { createCharacterFromCard, readCharacter, saveLorebook } from '../library'
import { buildCardV2, embedCard, extractCardJson, parseCard } from '../import/sillytavern'
import { isPng, solidPng } from '../import/png'
import { parseNote, updateNote } from '../vault/frontmatter'
import { vaultService } from '../vault/service'
import type { Vault } from '../vault/vault'
import { getMainWindow } from '../window'

const pathArg = z.tuple([z.string().min(1).max(1024)])

async function openDialog(opts: Electron.OpenDialogOptions): Promise<string[]> {
  const win = getMainWindow()
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return r.canceled ? [] : r.filePaths
}

/** Copies image bytes into Characters/avatars/ and returns the file name. */
async function storeAvatar(vault: Vault, name: string, data: Buffer, ext: string): Promise<string> {
  const dir = vault.rootPath(FOLDERS.avatars)
  await vault.mkdir(dir)
  const path = await vault.uniquePath(dir, sanitizeFileName(name), `.${ext}`)
  await vault.writeBinary(path, data)
  return basename(path)
}

/** Points a character note's `avatar` at a file, re-reading the note first so nothing is lost. */
async function setAvatarField(vault: Vault, path: string, file: string): Promise<CharacterNote> {
  await vault.mutate(path, (cur) => (cur === null ? null : updateNote(cur, { avatar: file })))
  return readCharacter(vault, path)
}

export function registerCharacterHandlers(): void {
  handle('characters:import', async (_e, campaignPath) => {
    const vault = vaultService.require()
    const campaign = campaignPath ? vaultService.getIndex()?.campaigns.find((c) => c.path === campaignPath) : undefined
    const files = await openDialog({
      title: 'Import SillyTavern character cards',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Character cards', extensions: ['png', 'json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    const imported: CharacterNote[] = []
    const failures: string[] = []
    for (const file of files) {
      try {
        const bytes = await fs.readFile(file)
        const { card, book } = parseCard(extractCardJson(bytes))
        if (isPng(bytes)) card.avatar = await storeAvatar(vault, card.name, bytes, 'png')
        if (campaign) card.campaigns = [campaignLink(campaign.path, campaign.displayName)]
        if (book) {
          const bookPath = await vault.uniquePath(vault.rootPath(FOLDERS.lorebooks), sanitizeFileName(book.name), '.md')
          await saveLorebook(vault, { path: bookPath, name: book.name, entries: book.entries, mtimeMs: 0, hash: '', intro: `Imported from the card “${card.name}”.` })
          await vaultService.reindex(bookPath)
        }
        const note = await createCharacterFromCard(vault, card, `\n# ${card.name}\n\nImported from \`${basename(file)}\`.\n`)
        await vaultService.reindex(note.path)
        imported.push(note)
      } catch (err) {
        failures.push(`${basename(file)}: ${toErrorInfo(err).message}`)
      }
    }
    if (failures.length) {
      if (!imported.length) throw new AppError('IMPORT_FAILED', 'No cards could be imported.', failures.join('\n'))
      send(getMainWindow(), 'toast', { level: 'warning', title: `${failures.length} card(s) could not be imported`, detail: failures.join('\n') })
    }
    return imported
  })

  handle(
    'characters:addToCampaign',
    async (_e, paths, campaignPath, mode) => {
      const vault = vaultService.require()
      const index = vaultService.getIndex()
      const campaign = index?.campaigns.find((c) => c.path === campaignPath)
      if (!campaign) throw new AppError('NO_CAMPAIGN', 'That campaign isn’t in the vault.')
      const nameOf = (folder: string): string | undefined => index?.campaigns.find((c) => c.path === folder)?.displayName
      const out: VaultPath[] = []
      for (const p of paths) {
        const summary = index?.characters.find((c) => c.path === p)
        if (!summary) continue
        if (mode === 'share') {
          // The same note: whatever happens to it shows up in every campaign it's in.
          const links = [...new Set([...(summary.campaigns ?? []), campaign.path])].map((f) => campaignLink(f, nameOf(f)))
          await vault.mutate(p, (cur) => (cur === null ? null : updateNote(cur, { campaigns: links })))
          await vaultService.reindex(p)
          out.push(p)
        } else {
          // A copy with its own sheet, so levels and loot stay in this campaign.
          const note = await readCharacter(vault, p)
          const card = { ...structuredClone(note.card), campaigns: [campaignLink(campaign.path, campaign.displayName)] }
          const body = `${note.body.trimEnd()}\n\nCopied from ${toWikilink(p, { full: true, alias: note.card.name })}.\n`
          const copy = await createCharacterFromCard(vault, card, body, false, `${note.card.name} (${campaign.displayName})`)
          await vaultService.reindex(copy.path)
          out.push(copy.path)
        }
      }
      return out
    },
    z.tuple([z.array(z.string().min(1).max(1024)).min(1).max(50), z.string().min(1).max(1024), z.enum(['copy', 'share'])])
  )

  handle(
    'characters:export',
    async (_e, path, format) => {
      const vault = vaultService.require()
      const note = await readCharacter(vault, path)
      const json = buildCardV2(note.card)
      const win = getMainWindow()
      const opts: Electron.SaveDialogOptions = {
        title: 'Export character card',
        defaultPath: `${sanitizeFileName(note.card.name)}.${format}`,
        filters: [{ name: format === 'png' ? 'PNG card' : 'JSON card', extensions: [format] }]
      }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return null
      if (format === 'json') {
        await fs.writeFile(r.filePath, JSON.stringify(json, null, 2))
      } else {
        let png: Buffer = solidPng(400, 600, [0x12, 0x10, 0x14])
        if (note.card.avatar) {
          const avatarPath = note.card.avatar.includes('/') ? joinVaultPath(note.card.avatar) : vault.rootPath(FOLDERS.avatars, note.card.avatar)
          const bytes = await vault.readBinary(avatarPath).catch(() => null)
          if (bytes) png = isPng(bytes) ? bytes : nativeImage.createFromBuffer(bytes).toPNG()
        }
        await fs.writeFile(r.filePath, embedCard(png, json))
      }
      return { path: r.filePath }
    },
    z.tuple([z.string().min(1), z.enum(['json', 'png'])])
  )

  handle(
    'characters:setAvatar',
    async (_e, path) => {
      const vault = vaultService.require()
      const [file] = await openDialog({
        title: 'Choose a portrait',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }]
      })
      if (!file) return null
      const ext = extname(file).slice(1).toLowerCase()
      if (!IMAGE_EXTENSIONS.includes(ext)) throw new AppError('BAD_IMAGE', 'That file is not a supported image.')
      const note = await readCharacter(vault, path)
      const name = await storeAvatar(vault, note.card.name, await fs.readFile(file), ext === 'jpeg' ? 'jpg' : ext)
      const updated = await setAvatarField(vault, path, name)
      await vaultService.reindex(path)
      return updated
    },
    pathArg
  )

  handle(
    'characters:delete',
    async (_e, path) => {
      const vault = vaultService.require()
      const file = await vault.readIfExists(path)
      if (!file) return
      const { data } = parseNote(file.content)
      if (data.type !== undefined && data.type !== 'character' && data.type !== 'npc') {
        throw new AppError('NOT_CHARACTER', 'That note is not a character.')
      }
      await vault.delete(path)
      vaultService.removeFromIndex(path)
    },
    pathArg
  )
}
