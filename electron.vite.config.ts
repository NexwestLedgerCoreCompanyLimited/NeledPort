import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

// Dev only: React Fast Refresh injects an inline preamble script that script-src 'self' would block.
// Production builds keep the strict policy from index.html.
const devCsp: Plugin = {
  name: 'neledport:dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss(), devCsp]
  }
})
