export interface TemplateContext {
  ports: Record<string, number>
  settings: Record<string, string>
  installDir: string
  /** Generated per server; never shown to the user. */
  adminPassword?: string
}

const PLACEHOLDER = /\{([A-Za-z][\w-]*(?::[A-Za-z][\w-]*)?)\}/g

export function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((m) => m[1])
}

// Single pass: substituted values are never scanned again, so a setting containing "{x}" stays literal.
export function expand(value: string, ctx: TemplateContext): string {
  return value.replace(PLACEHOLDER, (_, name: string) => {
    if (name === 'installDir') return ctx.installDir
    if (name === 'adminPassword' && ctx.adminPassword !== undefined) return ctx.adminPassword
    const [kind, key] = name.split(':')
    if (kind === 'port' && key in ctx.ports) return String(ctx.ports[key])
    if (kind === 'setting' && key in ctx.settings) return ctx.settings[key]
    throw new Error(`unknown placeholder {${name}}`)
  })
}
