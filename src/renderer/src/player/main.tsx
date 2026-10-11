import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PlayerApp } from './PlayerApp'
import '../styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlayerApp />
  </StrictMode>
)
