import { useEffect, useState } from 'react'
import { useApp } from '@/stores/app'

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** True when animations should be skipped (setting, or the OS setting when "system"). */
export function useReducedMotion(): boolean {
  const pref = useApp((s) => s.settings?.appearance.reduceMotion ?? 'system')
  const system = useSystemReducedMotion()
  return pref === 'on' || (pref === 'system' && system)
}

/** Mirrors appearance settings onto <html> as data attributes and CSS variables. */
export function useAppearance(): void {
  const appearance = useApp((s) => s.settings?.appearance)
  const material = useApp((s) => s.info?.material ?? 'none')
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!appearance) return
    const root = document.documentElement
    root.dataset.theme = appearance.theme
    root.dataset.material = appearance.theme === 'contrast' ? 'none' : material
    root.dataset.reduceMotion = String(reduced)
    root.style.setProperty('--ui-scale', String(appearance.uiScale))
    root.style.setProperty('--chat-font-size', `${appearance.chatFontSize}px`)
    if (appearance.accent) {
      root.style.setProperty('--primary', appearance.accent)
      root.style.setProperty('--gold', appearance.accent)
      root.style.setProperty('--ring', appearance.accent)
    } else {
      root.style.removeProperty('--primary')
      root.style.removeProperty('--gold')
      root.style.removeProperty('--ring')
    }
  }, [appearance, material, reduced])
}
