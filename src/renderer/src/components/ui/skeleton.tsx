import { cn } from '@/lib/utils'

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted/70', className)} {...props} />
}

/** Placeholder rows for sidebar lists while the vault index loads. */
export function ListSkeleton({ rows = 3, avatar = false }: { rows?: number; avatar?: boolean }): React.JSX.Element {
  return (
    <div className="space-y-1 px-3 py-1" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5 py-1.5">
          {avatar && <Skeleton className="size-8 shrink-0 rounded-full" />}
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3" style={{ width: `${70 - i * 12}%` }} />
            {avatar && <Skeleton className="h-2.5 w-1/3" />}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Placeholder for a session that is being opened. */
export function ChatSkeleton(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col" role="status" aria-label="Opening session">
      <div className="flex h-14 items-center gap-3 border-b px-6">
        <Skeleton className="size-8 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-6 py-8">
        {[0.92, 0.6, 0.85].map((w, i) => (
          <div key={i} className={cn('space-y-2', i === 1 && 'ml-auto w-2/3')}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3.5" style={{ width: `${w * 100}%` }} />
            <Skeleton className="h-3.5" style={{ width: `${w * 88}%` }} />
            {i !== 1 && <Skeleton className="h-3.5" style={{ width: `${w * 70}%` }} />}
          </div>
        ))}
      </div>
      <div className="mx-auto w-full max-w-3xl px-6 pb-5">
        <Skeleton className="h-12 rounded-xl" />
      </div>
    </div>
  )
}
