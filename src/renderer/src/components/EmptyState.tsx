import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  illustration: React.ReactNode
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
  size?: 'sm' | 'lg'
}

export function EmptyState({
  illustration,
  title,
  description,
  action,
  className,
  size = 'sm'
}: EmptyStateProps): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={cn('flex flex-col items-center justify-center text-center', size === 'lg' ? 'gap-4 p-10' : 'gap-2.5 p-6', className)}
    >
      <div className={cn('text-muted-foreground', size === 'lg' ? 'w-36' : 'w-16')}>{illustration}</div>
      <h3
        className={cn(
          'font-display font-semibold tracking-wide text-foreground',
          size === 'lg' ? 'text-xl' : 'text-sm'
        )}
      >
        {title}
      </h3>
      {description && (
        <p className={cn('max-w-sm text-muted-foreground', size === 'lg' ? 'text-sm leading-relaxed' : 'text-xs leading-relaxed')}>
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </motion.div>
  )
}
