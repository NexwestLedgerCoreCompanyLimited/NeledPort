import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer, type PluginOption } from 'vite'
import { expect, it } from 'vitest'
import config from '../../electron.vite.config'

it('dev HTML lets the CSP run the inline scripts Vite injects', async () => {
  const root = join(__dirname)
  const renderer = (config as { renderer: { plugins: PluginOption[] } }).renderer
  const server = await createServer({
    configFile: false,
    root,
    plugins: renderer.plugins,
    server: { middlewareMode: true, ws: false },
    logLevel: 'silent'
  })
  try {
    const html = await server.transformIndexHtml('/', readFileSync(join(root, 'index.html'), 'utf8'))
    const hasInlineScript = /<script[^>]*>\s*\S/.test(html.replace(/<script[^>]*\ssrc=[^>]*>\s*<\/script>/g, ''))
    const scriptSrc = /script-src([^;"]*)/.exec(html)?.[1] ?? ''
    expect(hasInlineScript).toBe(true)
    expect(scriptSrc).toContain("'unsafe-inline'")
  } finally {
    await server.close()
  }
})
