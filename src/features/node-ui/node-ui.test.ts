import { expect, it } from 'vitest'

const sources = import.meta.glob<string>(['./**/*.css', './**/*.vue', '/src/features/parameters/*.css', '/src/features/parameters/*.vue'], { query: '?raw', import: 'default', eager: true })
const css = Object.entries(sources)
  .map(([path, text]) => (path.endsWith('.vue') ? [...text.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') : text))
  .join('\n')

it('the node-ui and parameters styles declare no custom property they never read, and need no !important', () => {
  expect(Object.keys(sources).filter((path) => path.endsWith('.css')).sort()).toEqual(['/src/features/node-ui/bodies/bodies.css', '/src/features/node-ui/fields/fields.css', '/src/features/node-ui/node.css', '/src/features/parameters/parameters.css'])
  expect(css).toContain('.nui-gradient-stop')
  expect(css).toContain('.nui-file-menu')
  const declared = [...css.matchAll(/^\s*(--nui-[\w-]+):/gm)].map((m) => m[1])
  expect(declared.filter((name) => !css.includes(`var(${name})`))).toEqual([])
  expect(css).not.toContain('!important')
})
