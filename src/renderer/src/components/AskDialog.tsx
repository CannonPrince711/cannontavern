import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface AskRequest {
  kind: 'text' | 'confirm'
  title: string
  description?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  danger?: boolean
  resolve: (value: string | boolean | null) => void
}

const useAsk = create<{ request: AskRequest | null }>(() => ({ request: null }))

/** Asks for a line of text in a themed dialog. Resolves to null when cancelled. */
export function askText(opts: Omit<AskRequest, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => useAsk.setState({ request: { ...opts, kind: 'text', resolve: (v) => resolve(typeof v === 'string' ? v : null) } }))
}

/** Asks a yes/no question in a themed dialog. */
export function askConfirm(opts: Omit<AskRequest, 'kind' | 'resolve' | 'initial' | 'placeholder'>): Promise<boolean> {
  return new Promise((resolve) => useAsk.setState({ request: { ...opts, kind: 'confirm', resolve: (v) => resolve(v === true) } }))
}

export function AskDialog(): React.JSX.Element | null {
  const request = useAsk((s) => s.request)
  const [value, setValue] = useState('')
  useEffect(() => setValue(request?.initial ?? ''), [request])
  if (!request) return null

  const finish = (v: string | boolean | null): void => {
    useAsk.setState({ request: null })
    request.resolve(v)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && finish(null)}>
      <DialogContent className="w-[440px]">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (request.kind === 'confirm') finish(true)
            else if (value.trim()) finish(value.trim())
          }}
        >
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
            {request.description && <DialogDescription>{request.description}</DialogDescription>}
          </DialogHeader>
          {request.kind === 'text' && (
            <div className="px-6 pb-5">
              <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={request.placeholder} autoFocus aria-label={request.title} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => finish(request.kind === 'confirm' ? false : null)}>
              Cancel
            </Button>
            <Button type="submit" variant={request.danger ? 'destructive' : 'default'} disabled={request.kind === 'text' && !value.trim()} autoFocus={request.kind === 'confirm'}>
              {request.confirmLabel ?? (request.kind === 'confirm' ? 'Confirm' : 'OK')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
