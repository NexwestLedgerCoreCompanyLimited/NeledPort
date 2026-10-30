import { gzipSync } from 'node:zlib'

// Minimal .tar.gz writer for tests: ustar headers, regular files ('0'), folders ('5') and symlinks ('2').
export function makeTarGz(entries: { name: string; text?: string; type?: '0' | '5' | '2'; link?: string }[]): Buffer {
  const blocks: Buffer[] = []
  for (const e of entries) {
    const data = Buffer.from(e.text ?? '')
    const header = Buffer.alloc(512)
    header.write(e.name, 0, 100)
    header.write('0000644\0', 100)
    header.write('0000000\0', 108)
    header.write('0000000\0', 116)
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124)
    header.write('00000000000\0', 136)
    header.write('        ', 148)
    header.write(e.type ?? '0', 156)
    if (e.link) header.write(e.link, 157, 100)
    header.write('ustar\0', 257)
    header.write('00', 263)
    const sum = header.reduce((a, b) => a + b, 0)
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}
