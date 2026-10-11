import type { ErrorInfo } from '@shared/types'
import { redact } from './redact'

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: redact(err.message),
      detail: err.detail ? redact(err.detail) : undefined
    }
  }
  if (err instanceof Error) {
    return {
      code: (err as NodeJS.ErrnoException).code ?? 'ERROR',
      message: redact(err.message),
      detail: err.stack ? redact(err.stack) : undefined
    }
  }
  return { code: 'ERROR', message: redact(String(err)) }
}
