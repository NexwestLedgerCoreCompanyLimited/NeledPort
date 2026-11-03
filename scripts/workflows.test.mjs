import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

// GitHub runs nothing from a workflow file it cannot parse, and says little: v0.9.1's first release run died this way.
const dir = join(import.meta.dirname, '..', '.github', 'workflows')

describe('GitHub workflows', () => {
  it.each(readdirSync(dir).filter((f) => f.endsWith('.yml')))('%s is valid YAML with jobs', (file) => {
    const workflow = load(readFileSync(join(dir, file), 'utf8'))
    expect(Object.keys(workflow.jobs ?? {}).length).toBeGreaterThan(0)
  })
})
