import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, FilePlus2, Loader2, RotateCcw, Save } from 'lucide-react'
import { DEFAULT_DM_PROMPT, DEFAULT_PLAYER_PROMPT } from '@shared/prompt'
import { normalizeBlockOrder } from '@shared/prompt'
import { askText } from '@/components/AskDialog'
import { Button } from '@/components/ui/button'
import { Field, NativeSelect, SettingsGroup, Switch } from '@/components/ui/controls'
import { Textarea } from '@/components/ui/input'
import { invoke } from '@/lib/ipc'
import { useApp } from '@/stores/app'
import { toast } from '@/stores/toasts'
import { useVault } from '@/stores/vault'
import { NumberInput } from './fields'

// Stable empty list for the selector above (a fresh [] would loop).
const NO_PRESETS: never[] = []

const BLOCK_LABELS: Record<string, { label: string; hint: string }> = {
  preset: { label: 'DM preset', hint: 'System prompt and DM rules ([CHECK …] format)' },
  character: { label: 'Character card', hint: 'Description, personality, scenario, examples' },
  campaign: { label: 'Campaign & party', hint: 'Setting, tone, house rules, party gold and quests' },
  lorebook: { label: 'Lorebook entries', hint: 'Entries triggered by recent messages' },
  sheet: { label: 'Character sheet', hint: 'HP, AC, abilities with modifiers, inventory' },
  combat: { label: 'Combat state', hint: 'Initiative order, HP and conditions (only during a fight)' },
  recaps: { label: 'Previous sessions', hint: 'Recaps of earlier sessions in the campaign' },
  summary: { label: 'Session summary', hint: 'Rolling memory of older events' },
  history: { label: 'Chat history', hint: 'Recent messages, trimmed to fit' },
  extensions: { label: 'Extensions', hint: 'Blocks added by enabled extensions' }
}

function PresetEditor(): React.JSX.Element {
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const presets = useVault((s) => s.index?.presets) ?? NO_PRESETS
  const current = settings.general.defaultPreset
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!current) {
      setText(DEFAULT_DM_PROMPT)
      setLoaded(DEFAULT_DM_PROMPT)
      return
    }
    invoke('presets:get', current)
      .then((p) => {
        setText(p.system_prompt)
        setLoaded(p.system_prompt)
      })
      .catch((err) => toast.error(err))
  }, [current])

  const create = async (): Promise<void> => {
    const name = await askText({ title: 'New DM preset', description: 'Creates a note in Presets/ starting from the built-in prompt. The note body is the prompt.', initial: 'My DM Style' })
    if (!name) return
    try {
      const path = await invoke('presets:create', name)
      await updateSettings({ general: { defaultPreset: path } })
    } catch (err) {
      toast.error(err)
    }
  }

  const save = async (): Promise<void> => {
    if (!current) return
    setBusy(true)
    try {
      await invoke('presets:save', current, text)
      setLoaded(text)
      toast.success('Preset saved')
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsGroup title="DM preset" description="The system prompt that sets the DM’s voice and rules. Presets are notes in Presets/, so you can also edit them in Obsidian.">
      <div className="flex items-end gap-2 py-3">
        <Field label="Active preset" htmlFor="p-preset" className="flex-1 py-0">
          <NativeSelect id="p-preset" value={current ?? ''} onChange={(e) => void updateSettings({ general: { defaultPreset: e.target.value || null } })}>
            <option value="">Built-in Dungeon Master</option>
            {presets.map((p) => (
              <option key={p.path} value={p.path}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button variant="outline" onClick={() => void create()}>
          <FilePlus2 /> New preset
        </Button>
        {current && (
          <Button variant="ghost" size="icon" aria-label="Open preset in Obsidian" onClick={() => void invoke('vault:openInObsidian', current)}>
            <ExternalLink />
          </Button>
        )}
      </div>
      <Field label={current ? 'Prompt' : 'Built-in prompt (read-only: create a preset to customise it)'} htmlFor="p-text" description="Use {{user}} for the player and {{char}} for the character.">
        <Textarea id="p-text" rows={10} value={text} readOnly={!current} onChange={(e) => setText(e.target.value)} className="font-mono text-[12.5px] leading-relaxed" />
      </Field>
      {current && (
        <div className="flex justify-end gap-2 py-3">
          <Button variant="ghost" onClick={() => setText(DEFAULT_DM_PROMPT)}>
            <RotateCcw /> Use built-in text
          </Button>
          <Button onClick={() => void save()} disabled={busy || text === loaded}>
            {busy ? <Loader2 className="animate-spin" /> : <Save />} Save preset
          </Button>
        </div>
      )}
    </SettingsGroup>
  )
}

/** The AI's instructions when it plays the character (You are DM / AI only), plus auto-play pacing. */
function PlaySettings(): React.JSX.Element {
  const settings = useApp((s) => s.settings!)
  const updateSettings = useApp((s) => s.updateSettings)
  const [text, setText] = useState(settings.prompt.playerPrompt || DEFAULT_PLAYER_PROMPT)
  const saved = settings.prompt.playerPrompt || DEFAULT_PLAYER_PROMPT
  return (
    <SettingsGroup title="When the AI plays the character" description="Used in “You are the DM” and “AI only” sessions. Change a session’s mode from the chat header, or set “mode: user-dm” or “mode: ai-only” in a Campaign.md to make it the default there.">
      <Field label="Player prompt" htmlFor="p-player">
        <Textarea id="p-player" rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-[12.5px] leading-relaxed" />
      </Field>
      <div className="flex justify-end gap-2 py-2">
        <Button variant="ghost" onClick={() => setText(DEFAULT_PLAYER_PROMPT)}>
          <RotateCcw /> Use built-in text
        </Button>
        <Button onClick={() => void updateSettings({ prompt: { playerPrompt: text.trim() === DEFAULT_PLAYER_PROMPT ? '' : text } })} disabled={text === saved}>
          <Save /> Save
        </Button>
      </div>
      <Field inline label="Tips & ideas bubble" description="The lightbulb above the message box: AI ideas for your next move (as the player, the DM or the director) and rotating tips.">
        <Switch aria-label="Tips and ideas bubble" checked={settings.play.tipsBubble} onCheckedChange={(v) => void updateSettings({ play: { tipsBubble: v } })} />
      </Field>
      <Field inline label="Refresh ideas after every reply" description="Uses the summaries model once per reply.">
        <Switch aria-label="Refresh ideas after every reply" checked={settings.play.ideasAuto} onCheckedChange={(v) => void updateSettings({ play: { ideasAuto: v } })} />
      </Field>
      <div className="grid grid-cols-2 gap-4 py-3">
        <NumberInput label="AI only: turns per Auto-play" value={settings.play.autoplayTurns} min={1} max={100} onChange={(v) => void updateSettings({ play: { autoplayTurns: v } })} />
        <NumberInput label="AI only: pause between turns" value={settings.play.autoplayDelaySec} min={0} max={30} step={0.5} onChange={(v) => void updateSettings({ play: { autoplayDelaySec: v } })} suffix="s" />
      </div>
    </SettingsGroup>
  )
}

export function PromptSection(): React.JSX.Element {
  const prompt = useApp((s) => s.settings!.prompt)
  const updateSettings = useApp((s) => s.updateSettings)
  const set = (patch: Partial<typeof prompt>): void => void updateSettings({ prompt: patch })

  // Keep every known block in the list, even if settings predate one.
  const blocks = normalizeBlockOrder(prompt.blocks)
  const move = (i: number, dir: -1 | 1): void => {
    const next = [...blocks]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    set({ blocks: next })
  }

  return (
    <div className="space-y-6">
      <PresetEditor />
      <PlaySettings />

      <SettingsGroup title="Prompt blocks" description="Assembled in this order. Everything above “Chat history” becomes the system prompt; switch blocks off to leave them out.">
        <ol className="space-y-1 py-2">
          {blocks.map((b, i) => (
            <li key={b.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/50">
              <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{BLOCK_LABELS[b.id]?.label ?? b.id}</span>
                <span className="block truncate text-xs text-muted-foreground">{BLOCK_LABELS[b.id]?.hint}</span>
              </span>
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${b.id} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Move ${b.id} down`} onClick={() => move(i, 1)} disabled={i === blocks.length - 1}>
                <ArrowDown />
              </Button>
              <Switch
                aria-label={`Include ${b.id}`}
                checked={b.enabled}
                onCheckedChange={(v) => set({ blocks: blocks.map((x) => (x.id === b.id ? { ...x, enabled: v } : x)) })}
              />
            </li>
          ))}
        </ol>
      </SettingsGroup>

      <SettingsGroup title="Context & memory">
        <div className="grid grid-cols-2 gap-4 py-3">
          <NumberInput label="Context budget (0 = backend’s context size)" value={prompt.contextBudget} min={0} step={512} onChange={(v) => set({ contextBudget: v })} suffix="tok" />
          <NumberInput label="Update session summary every N messages (0 = off)" value={prompt.summaryEvery} min={0} max={500} onChange={(v) => set({ summaryEvery: v })} />
          <NumberInput label="Messages scanned for lorebook keywords" value={prompt.lorebookScanDepth} min={1} max={100} onChange={(v) => set({ lorebookScanDepth: v })} />
          <NumberInput label="Lorebook token budget (0 = unlimited)" value={prompt.lorebookTokenBudget} min={0} step={128} onChange={(v) => set({ lorebookTokenBudget: v })} suffix="tok" />
        </div>
        <Field
          inline
          label="Automatic sheet updates"
          description="Asks the model to add a hidden <state>{…}</state> line when HP, gold, items or conditions change. The app applies it to the sheet, hides it, and posts each change with an Undo button."
        >
          <Switch aria-label="Automatic sheet updates" checked={prompt.autoState} onCheckedChange={(v) => set({ autoState: v })} />
        </Field>
        <Field
          inline
          label="Compress finished sessions"
          description="When you leave a session (switch away, start a new one or close the app), the chat is compressed into a short recap saved in the session note. Later sessions in the campaign get those recaps instead of the full transcripts."
        >
          <Switch aria-label="Compress finished sessions" checked={prompt.autoRecap} onCheckedChange={(v) => set({ autoRecap: v })} />
        </Field>
        <div className="grid grid-cols-2 gap-4 py-3">
          <NumberInput label="Recaps of earlier sessions to include (0 = none)" value={prompt.recapCount} min={0} max={20} onChange={(v) => set({ recapCount: v })} />
        </div>
      </SettingsGroup>
    </div>
  )
}
