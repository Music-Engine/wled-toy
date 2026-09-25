import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('node-ui.css declares no custom property it never reads, and needs no !important', () => {
  const css = readFileSync(new URL('./node-ui.css', import.meta.url), 'utf8')
  const declared = [...css.matchAll(/^\s*(--nui-[\w-]+):/gm)].map((m) => m[1])
  expect(declared.filter((name) => !css.includes(`var(${name})`))).toEqual([])
  expect(css).not.toContain('!important')
})
