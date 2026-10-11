import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')

/**
 * React Fast Refresh injects an inline preamble script in dev, which the strict
 * CSP blocks. Relax script-src for the dev server only; production builds keep
 * the CSP from index.html untouched.
 */
function devCsp(): Plugin {
  return {
    name: 'dnd-tavern:dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    // ws (the multiplayer server) tries optional native add-ons; bundling turns
    // them into empty stubs that crash on the first message. Tell it to skip them.
    define: {
      'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('1'),
      'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('1')
    },
    build: {
      // Bundle dependencies into the main bundle: some are ESM-only (chokidar),
      // and the packaged app then needs no node_modules at all.
      externalizeDeps: false
    }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      // Sandboxed preloads cannot require() node_modules, so bundle everything.
      externalizeDeps: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [react(), tailwindcss(), devCsp()],
    // electron-vite doesn't minify by default. Main/preload stay readable for
    // stack traces; the renderer is minified to keep startup fast.
    build: {
      minify: 'esbuild',
      rollupOptions: {
        // The app, and the player page the multiplayer host serves to browsers.
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          player: resolve(__dirname, 'src/renderer/player.html')
        }
      }
    }
  }
})
