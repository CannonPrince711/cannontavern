/**
 * Slash commands for the chat input. Later build steps (dice, combat, images,
 * extensions) register more commands into the same registry.
 */
import type { Session } from '@shared/types'
import { useChat } from '@/stores/chat'
import { toast } from '@/stores/toasts'
import { useUi } from '@/stores/ui'
import { useVault } from '@/stores/vault'
import { invoke } from './ipc'
import { PLAY_MODE_INFO, PLAY_MODES, playModeOf } from '@shared/play'
import { useAutoplay } from './play'

export interface CommandContext {
  session: Session
  args: string
}

export interface SlashCommand {
  name: string
  usage: string
  description: string
  run: (ctx: CommandContext) => void | Promise<void>
  /** Extension commands show their source. */
  source?: string
}

const registry = new Map<string, SlashCommand>()

export function registerCommand(cmd: SlashCommand): void {
  registry.set(cmd.name.toLowerCase(), cmd)
}

export function unregisterCommands(source: string): void {
  for (const [k, v] of registry) if (v.source === source) registry.delete(k)
}

export function listCommands(): SlashCommand[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function matchCommands(input: string): SlashCommand[] {
  const m = /^\/(\S*)$/.exec(input.trim())
  if (!m) return []
  const q = m[1]!.toLowerCase()
  return listCommands().filter((c) => c.name.startsWith(q))
}

/** Runs "/name args". Returns false when the input isn't a known command. */
export async function runCommand(input: string, session: Session): Promise<boolean> {
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(input.trim())
  if (!m) return false
  const cmd = registry.get(m[1]!.toLowerCase())
  if (!cmd) {
    toast.warning(`Unknown command /${m[1]}`, 'Type / to see the list.')
    return true
  }
  try {
    await cmd.run({ session, args: m[2]!.trim() })
  } catch (err) {
    toast.error(err, `/${cmd.name} failed`)
  }
  return true
}

// ─── Built-in commands ──────────────────────────────────────────────────────

registerCommand({
  name: 'help',
  usage: '/help',
  description: 'List every command',
  run: () => {
    const lines = listCommands()
      .map((c) => `\`${c.usage}\`: ${c.description}`)
      .join('\n')
    void useChat.getState().post({ role: 'system', text: `**Commands**\n\n${lines}`, swipes: [], swipeIndex: 0, hidden: true })
  }
})

registerCommand({
  name: 'continue',
  usage: '/continue',
  description: 'Continue the last DM reply',
  run: () => useChat.getState().continueReply()
})

registerCommand({
  name: 'regen',
  usage: '/regen',
  description: 'Write another version of the last reply (Ctrl+R)',
  run: () => useChat.getState().regenerate()
})

registerCommand({
  name: 'sys',
  usage: '/sys <text>',
  description: 'Add a note the DM will see, e.g. a scene change',
  run: ({ args }) => {
    if (!args) throw new Error('Usage: /sys <text>')
    return useChat.getState().post({ role: 'system', text: args, swipes: [], swipeIndex: 0 })
  }
})

registerCommand({
  name: 'note',
  usage: '/note <note name>',
  description: 'Pull any vault note into the conversation for the DM',
  run: async ({ args }) => {
    if (!args) throw new Error('Usage: /note <note name>')
    const hits = await invoke('vault:searchNotes', args)
    const hit = hits.find((h) => h.name.toLowerCase() === args.toLowerCase()) ?? hits[0]
    if (!hit) throw new Error(`No note matches “${args}”.`)
    const { content } = await invoke('vault:readNote', hit.path)
    const body = content.replace(/^---[\s\S]*?\n---\s*\n?/, '').trim()
    await useChat.getState().post({
      role: 'system',
      name: hit.name,
      text: `Reference note [[${hit.name}]]:\n\n${body.slice(0, 12_000)}`,
      swipes: [],
      swipeIndex: 0
    })
  }
})

registerCommand({
  name: 'title',
  usage: '/title <new title>',
  description: 'Rename this session',
  run: async ({ session, args }) => {
    if (!args) throw new Error('Usage: /title <new title>')
    useChat.setState({ session: await invoke('sessions:updateMeta', session.path, { title: args }) })
  }
})

registerCommand({
  name: 'mode',
  usage: '/mode ai-dm | user-dm | ai-only',
  description: 'Who plays: the AI as DM, you as DM, or the AI on both sides',
  run: async ({ session, args }) => {
    const wanted = args.trim().toLowerCase()
    const mode = PLAY_MODES.find((m) => m === wanted || PLAY_MODE_INFO[m].short.toLowerCase() === wanted)
    if (!mode) throw new Error('Usage: /mode ai-dm | user-dm | ai-only')
    useChat.setState({ session: await invoke('sessions:updateMeta', session.path, { mode }) })
    toast.info(PLAY_MODE_INFO[mode].label, PLAY_MODE_INFO[mode].description)
  }
})

registerCommand({
  name: 'autoplay',
  usage: '/autoplay [turns]',
  description: 'AI-only sessions: let the story play itself for a number of turns',
  run: async ({ session, args }) => {
    if (playModeOf(session.frontmatter) !== 'ai-only') throw new Error('Auto-play works in AI-only sessions. Switch with /mode ai-only.')
    const n = args.trim() ? Number(args) : undefined
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 100)) throw new Error('Usage: /autoplay [1–100]')
    useAutoplay.getState().start(n)
  }
})

registerCommand({
  name: 'compress',
  usage: '/compress',
  description: 'Compress this session into a recap now (also happens automatically when you leave it)',
  run: async ({ session }) => {
    toast.info('Compressing this session…')
    const updated = await invoke('sessions:compress', session.path, true)
    const recap = updated?.frontmatter.recap
    if (!recap) return
    await useChat.getState().post({ role: 'system', text: `**Session recap**\n\n${recap}`, swipes: [], swipeIndex: 0, hidden: true })
  }
})

registerCommand({
  name: 'new',
  usage: '/new',
  description: 'Start a new session in this campaign',
  run: () => {
    useVault.getState().selectSession(null)
    useUi.setState({ settingsOpen: false })
  }
})
