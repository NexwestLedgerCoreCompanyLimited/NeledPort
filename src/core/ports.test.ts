import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { isPortFree } from './ports'

describe('isPortFree', () => {
  it('detects a TCP port that is in use', async () => {
    const server = createServer()
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as { port: number }).port
    expect(await isPortFree(port, 'tcp')).toBe(false)
    server.close()
    await new Promise((r) => setTimeout(r, 50))
    expect(await isPortFree(port, 'tcp')).toBe(true)
  })

  it('checks UDP ports', async () => {
    expect(await isPortFree(0, 'udp')).toBe(true)
  })
})
