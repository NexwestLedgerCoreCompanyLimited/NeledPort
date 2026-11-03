import { defineConfig } from 'vite'

// The neledport CLI as one Node file with its dependencies inside (npm run build:cli).
export default defineConfig({
  build: {
    ssr: 'src/cli/bin.ts',
    outDir: 'out/cli/dist',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'neledport.mjs', format: 'es', banner: '#!/usr/bin/env node', codeSplitting: false } }
  },
  ssr: { noExternal: true, target: 'node' }
})
