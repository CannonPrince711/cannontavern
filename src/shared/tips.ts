/**
 * Tips & tricks: static tips shown for free, plus helpers for the AI ideas
 * ("what could I do next?") the tips bubble asks the summaries model for.
 */
import type { PlayMode } from './play'

export type TipAudience = 'player' | 'dm' | 'app'

export const STATIC_TIPS: { audience: TipAudience; text: string }[] = [
  { audience: 'player', text: 'Describe intent, not just action: “I search the desk for anything with the harbourmaster’s seal” gives the DM more to work with.' },
  { audience: 'player', text: 'Help actions are free advantage: describe how you assist an ally and ask the DM for it.' },
  { audience: 'player', text: 'Talk to NPCs. Questions about rumours, fears and prices often open doors a fight never would.' },
  { audience: 'player', text: 'Short rests restore hit dice healing and some class features. Ask for one before the big door.' },
  { audience: 'player', text: 'Your sheet’s proficient skills (gold dots) are where you shine. Look for ways to use them.' },
  { audience: 'player', text: 'Ready an action (“If the guard opens the gate, I slip through”) to act on someone else’s turn.' },
  { audience: 'dm', text: 'Say “yes, and…” or “yes, but…”: let the attempt happen, then add a cost or a twist.' },
  { audience: 'dm', text: 'Only call for a roll when failure is interesting. Otherwise, just let it succeed.' },
  { audience: 'dm', text: 'Typical DCs: 10 easy, 15 medium, 20 hard, 25 very hard.' },
  { audience: 'dm', text: 'Give every NPC one want and one quirk; it makes improvising their lines easy.' },
  { audience: 'dm', text: 'End scenes on a question: a knock at the door, a missing item, a name overheard.' },
  { audience: 'dm', text: 'Type [CHECK perception DC 13] in your narration and the character’s roll is made for you.' },
  { audience: 'app', text: 'Ctrl+K searches everything: sessions, characters, commands and any note in your vault.' },
  { audience: 'app', text: 'Right-click a message for copy, edit, regenerate, fork and more. Your mouse’s back button flips to the previous reply.' },
  { audience: 'app', text: 'Alt+← and Alt+→ switch between alternative replies; Ctrl+R writes another one.' },
  { audience: 'app', text: '/note <name> pulls any vault note into the conversation for the DM.' },
  { audience: 'app', text: 'Leaving a session compresses it into a recap, so the next session remembers what happened.' },
  { audience: 'app', text: 'Change who plays from the chat header: the AI as DM, you as DM, or the AI on both sides.' },
  { audience: 'app', text: 'The prompt inspector (in the chat header) shows exactly what is sent to the model.' }
]

/** Static tips that fit the user's role in this mode (app tips for everyone). */
export function tipsFor(mode: PlayMode): string[] {
  const audience: TipAudience = mode === 'user-dm' ? 'dm' : 'player'
  return STATIC_TIPS.filter((t) => t.audience === audience || t.audience === 'app' || mode === 'ai-only').map((t) => t.text)
}

export const IDEAS_SYSTEM: Record<PlayMode, string> = {
  'ai-dm':
    'You coach the player of a Dungeons & Dragons game. Suggest 3 distinct, concrete things their character could do next, using the situation and the character’s skills, items and spells. Each starts with a verb, is at most 20 words, and may name a relevant skill with its modifier. Never decide outcomes.',
  'user-dm':
    'You assist the Dungeon Master of a Dungeons & Dragons game. Suggest 3 concrete ideas for the DM’s next move: one complication or twist, one NPC reaction or line of dialogue, and one check worth calling, written as [CHECK <skill> DC <number>] with a fair DC. At most 25 words each.',
  'ai-only':
    'You help someone directing an AI-run Dungeons & Dragons story. Suggest 3 short director’s notes that would make the next scenes more interesting: a twist, a character moment, and a change of pace. At most 20 words each, written as instructions.'
}

/** Pulls up to `n` ideas out of a model reply (a JSON array, or a bulleted/numbered list). */
export function parseIdeas(reply: string, n = 3): string[] {
  const clean = (s: string): string => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["“]|["”]$/g, '').trim()
  const start = reply.indexOf('[')
  const end = reply.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(reply.slice(start, end + 1)) as unknown
      if (Array.isArray(arr)) {
        const ideas = arr.filter((x): x is string => typeof x === 'string').map(clean).filter(Boolean)
        if (ideas.length) return ideas.slice(0, n)
      }
    } catch {
      // Not JSON (e.g. a [CHECK …] tag); fall back to lines.
    }
  }
  return reply
    .split('\n')
    .map(clean)
    .filter((l) => l.length > 3 && !/^(here are|ideas?:|suggestions?:)/i.test(l))
    .slice(0, n)
}
