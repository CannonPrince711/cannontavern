/**
 * Every secret the main process decrypts is registered here so it can be
 * masked out of error messages, logs and the prompt inspector.
 */
const secrets = new Set<string>()

export function registerSecret(value: string): void {
  if (value.length >= 4) secrets.add(value)
}

export function redact(text: string): string {
  let out = text
  for (const s of secrets) out = out.split(s).join(mask(s))
  // Common bearer/key patterns, in case a secret reached us from elsewhere.
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1••••')
  out = out.replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}/g, '$1-••••')
  return out
}

export function mask(secret: string): string {
  return secret.length <= 8 ? '••••' : `${secret.slice(0, 3)}••••${secret.slice(-2)}`
}
