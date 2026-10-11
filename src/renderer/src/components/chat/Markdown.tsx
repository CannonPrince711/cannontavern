import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Dices } from 'lucide-react'
import { joinVaultPath } from '@shared/names'
import { invoke } from '@/lib/ipc'
import { toast } from '@/stores/toasts'
import { vaultUrl } from '@/stores/vault'

interface MdNode {
  type: string
  value?: string
  url?: string
  alt?: string
  children?: MdNode[]
}

const INLINE_RE = /(!?)\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]|\[CHECK\s+([a-z ]+?)\s+DC\s*(\d+)\]/gi

/**
 * remark plugin: [[Note]] / [[Note|alias]] → link (opens in Obsidian),
 * ![[image.png]] → image from the campaign's Images folder,
 * [CHECK dex DC 14] → a "Roll it" button.
 */
function remarkTavern() {
  const split = (value: string): MdNode[] => {
    const out: MdNode[] = []
    let last = 0
    for (const m of value.matchAll(INLINE_RE)) {
      const i = m.index ?? 0
      if (i > last) out.push({ type: 'text', value: value.slice(last, i) })
      if (m[4]) {
        out.push({ type: 'link', url: `check:${encodeURIComponent(m[4].trim().toLowerCase())}:${m[5]}`, children: [{ type: 'text', value: m[0] }] })
      } else if (m[1] === '!') {
        out.push({ type: 'image', url: `embed:${encodeURIComponent(m[2]!.trim())}`, alt: m[3] ?? m[2]!.trim() })
      } else {
        out.push({ type: 'link', url: `wikilink:${encodeURIComponent(m[2]!.trim())}`, children: [{ type: 'text', value: (m[3] ?? m[2]!).trim() }] })
      }
      last = i + m[0].length
    }
    if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
    return out
  }
  const walk = (node: MdNode): void => {
    if (!node.children || node.type === 'link' || node.type === 'inlineCode' || node.type === 'code') return
    const next: MdNode[] = []
    for (const child of node.children) {
      if (child.type === 'text' && child.value && INLINE_RE.test(child.value)) {
        INLINE_RE.lastIndex = 0
        next.push(...split(child.value))
      } else {
        walk(child)
        next.push(child)
      }
      INLINE_RE.lastIndex = 0
    }
    node.children = next
  }
  return (tree: MdNode) => walk(tree)
}

async function openWikilink(target: string): Promise<void> {
  try {
    const hits = await invoke('vault:searchNotes', target)
    const exact = hits.find((h) => h.name.toLowerCase() === target.toLowerCase() || h.path.replace(/\.md$/i, '').toLowerCase() === target.toLowerCase())
    const hit = exact ?? hits[0]
    if (!hit) {
      toast.info(`No note called “${target}” in the vault yet.`)
      return
    }
    await invoke('vault:openInObsidian', hit.path)
  } catch (err) {
    toast.error(err)
  }
}

export interface MarkdownProps {
  text: string
  /** Campaign folder, for resolving ![[image]] embeds. */
  campaignPath?: string
  onCheck?: (ability: string, dc: number) => void
}

export const Markdown = memo(function Markdown({ text, campaignPath, onCheck }: MarkdownProps): React.JSX.Element {
  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith('wikilink:')) {
        const target = decodeURIComponent(href.slice(9))
        return (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              void openWikilink(target)
            }}
            className="wikilink"
            title={`Open “${target}” in Obsidian`}
          >
            {children}
          </a>
        )
      }
      if (href?.startsWith('check:')) {
        const [, ability, dc] = href.split(':')
        const label = decodeURIComponent(ability ?? '')
        return (
          <button
            type="button"
            onClick={() => onCheck?.(label, Number(dc))}
            disabled={!onCheck}
            className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 align-middle font-sans text-[0.72em] font-semibold tracking-wide text-gold uppercase hover:bg-gold/20 disabled:opacity-70"
            title={`Roll a ${label} check against DC ${dc}`}
          >
            <Dices className="size-3" /> {label} DC {dc}
            {onCheck && <span className="font-medium normal-case opacity-80">· Roll it</span>}
          </button>
        )
      }
      const safe = href && /^(https:|obsidian:)/i.test(href)
      if (!safe) return <span className="underline decoration-dotted">{children}</span>
      return (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault()
            void invoke('app:openExternal', href).catch((err) => toast.error(err))
          }}
          title={href}
        >
          {children}
        </a>
      )
    },
    img: ({ src, alt }) => {
      const url = typeof src === 'string' ? src : ''
      if (url.startsWith('embed:') && campaignPath) {
        const file = decodeURIComponent(url.slice(6))
        const path = file.includes('/') ? joinVaultPath(file) : joinVaultPath(campaignPath, 'Images', file)
        return <img src={vaultUrl(path)} alt={alt ?? ''} className="my-2 max-h-96 rounded-lg" loading="lazy" />
      }
      return <span className="text-muted-foreground">[image: {alt}]</span>
    }
  }
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkTavern]} urlTransform={(u) => u} components={components}>
      {text}
    </ReactMarkdown>
  )
})
