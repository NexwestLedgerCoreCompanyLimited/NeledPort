/** Splits a typed command line into arguments the way a shell would: quotes group words, no expansion. */
export function splitArgs(text: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  let quoted = false
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = null
      else cur += c
    } else if (c === '"' || c === "'") {
      quote = c
      quoted = true
    } else if (/\s/.test(c)) {
      if (cur || quoted) out.push(cur)
      cur = ''
      quoted = false
    } else cur += c
  }
  if (cur || quoted) out.push(cur)
  return out
}
