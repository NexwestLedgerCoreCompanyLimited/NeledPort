import { createSocket } from 'node:dgram'
import { createServer } from 'node:net'

/** True when nothing on this computer is bound to the port. */
export function isPortFree(port: number, protocol: 'udp' | 'tcp'): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' ? resolve(false) : reject(e))
    if (protocol === 'tcp') {
      const server = createServer()
      server.once('error', onError)
      server.listen(port, () => server.close(() => resolve(true)))
    } else {
      const socket = createSocket('udp4')
      socket.once('error', onError)
      socket.bind(port, () => socket.close(() => resolve(true)))
    }
  })
}
