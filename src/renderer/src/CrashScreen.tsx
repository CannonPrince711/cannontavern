import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Last line of defence: if rendering throws, show what went wrong and a way
 * out instead of a blank window. Uses plain elements and inline styles, so it
 * works even if the app's own components are what broke.
 */
export class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null; stack: string }> {
  override state = { error: null as Error | null, stack: '' }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[crash]', error, info.componentStack)
    this.setState({ stack: info.componentStack ?? '' })
  }

  override render(): ReactNode {
    const { error, stack } = this.state
    if (!error) return this.props.children
    const details = `${error.name}: ${error.message}\n${error.stack ?? ''}\n\nComponents:${stack}`
    return (
      <div style={{ minHeight: '100vh', padding: 32, background: '#121014', color: '#e8e2d6', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>DND Tavern hit a problem</h1>
        <p style={{ color: '#a59d90', marginBottom: 16, maxWidth: 640, lineHeight: 1.5 }}>
          The window couldn’t be drawn. Your vault and settings are safe. Reload to try again; if it keeps happening, copy the details and report them.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button type="button" onClick={() => location.reload()} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #d4a843', background: '#d4a84322', color: '#e8e2d6', cursor: 'pointer' }}>
            Reload
          </button>
          <button type="button" onClick={() => void navigator.clipboard.writeText(details)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #3a3440', background: 'transparent', color: '#e8e2d6', cursor: 'pointer' }}>
            Copy details
          </button>
        </div>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#a59d90', background: '#1b181f', padding: 12, borderRadius: 8, maxHeight: '50vh', overflow: 'auto', userSelect: 'text' }}>{details}</pre>
      </div>
    )
  }
}
