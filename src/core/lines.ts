// SteamCMD and many Linux servers colour their output; the codes would break parsing and show as junk in the UI.
export const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

// Turns a byte stream into clean lines; SteamCMD and some servers use bare \r for progress updates.
export function lineReader(onLine: (line: string) => void): { push(chunk: Buffer | string): void; flush(): void } {
  let rest = ''
  return {
    push(chunk) {
      const parts = (rest + chunk.toString()).split(/\r\n|\r|\n/)
      rest = parts.pop() ?? ''
      for (const line of parts) onLine(stripAnsi(line))
    },
    flush() {
      if (rest) onLine(stripAnsi(rest))
      rest = ''
    }
  }
}
