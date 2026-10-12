import { useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Label, Textarea } from '@/components/ui/input'
import { splitTags } from '@shared/tags'

/**
 * Pick the tags for a (re)generated image: remove any by clicking ×, add your
 * own, or edit the whole prompt as text.
 */
export function TagsDialog({
  title,
  description,
  initial,
  submitLabel = 'Regenerate',
  onSubmit,
  onClose
}: {
  title: string
  description: string
  initial: string
  submitLabel?: string
  onSubmit: (prompt: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [tags, setTags] = useState<string[]>(() => splitTags(initial))
  const [draft, setDraft] = useState('')
  const [asText, setAsText] = useState(false)
  const [text, setText] = useState(initial)

  const add = (): void => {
    const extra = splitTags(draft)
    if (extra.length) setTags((cur) => splitTags([...cur, ...extra].join(', ')))
    setDraft('')
  }
  const prompt = asText ? text.trim() : tags.join(', ')

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(640px,calc(100vw-48px))]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-6 py-2">
          {asText ? (
            <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Prompt" className="font-mono text-xs" />
          ) : (
            <>
              <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto rounded-lg border bg-card/60 p-2" role="list" aria-label="Tags">
                {tags.length === 0 && <span className="px-1 text-xs text-muted-foreground">No tags yet: add some below.</span>}
                {tags.map((t) => (
                  <span key={t} role="listitem" className="flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs">
                    {t}
                    <button type="button" aria-label={`Remove ${t}`} onClick={() => setTags((cur) => cur.filter((x) => x !== t))} className="text-muted-foreground hover:text-crimson">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="space-y-1">
                <Label htmlFor="tags-add">Add tags</Label>
                <Input
                  id="tags-add"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    add()
                  }}
                  onBlur={add}
                  placeholder="e.g. smiling, night, rain, close-up (Enter to add)"
                />
              </div>
            </>
          )}
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              if (asText) setTags(splitTags(text))
              else setText(tags.join(', '))
              setAsText(!asText)
            }}
          >
            {asText ? 'Edit as tags' : 'Edit as text'}
          </button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSubmit(prompt)
              onClose()
            }}
          >
            <RefreshCw /> {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
