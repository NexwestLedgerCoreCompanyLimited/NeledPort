// Turns a byte stream into lines; SteamCMD and some servers use bare \r for progress updates.
export function lineReader(onLine: (line: string) => void): { push(chunk: Buffer | string): void; flush(): void } {
  let rest = ''
  return {
    push(chunk) {
      const parts = (rest + chunk.toString()).split(/\r\n|\r|\n/)
      rest = parts.pop() ?? ''
      for (const line of parts) onLine(line)
    },
    flush() {
      if (rest) onLine(rest)
      rest = ''
    }
  }
}
