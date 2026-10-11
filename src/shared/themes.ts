import type { ThemeId } from './types'

export interface ThemeMeta {
  id: ThemeId
  label: string
  /** Electron nativeTheme source, which also tints Mica. */
  native: 'dark' | 'light'
  /** Title bar background; must match --titlebar in globals.css. */
  titlebar: string
  /** Colour of the native minimise/maximise/close glyphs. */
  symbol: string
  /** Window background before the renderer paints. */
  background: string
}

export const THEMES: Record<ThemeId, ThemeMeta> = {
  dark: {
    id: 'dark',
    label: 'Dark',
    native: 'dark',
    titlebar: '#0e0c10',
    symbol: '#d8d0c4',
    background: '#121014'
  },
  parchment: {
    id: 'parchment',
    label: 'Parchment',
    native: 'light',
    titlebar: '#e9dfc6',
    symbol: '#2a2118',
    background: '#f4ecd8'
  },
  contrast: {
    id: 'contrast',
    label: 'High contrast',
    native: 'dark',
    titlebar: '#000000',
    symbol: '#ffffff',
    background: '#000000'
  }
}

export const TITLEBAR_HEIGHT = 40
