import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { createApp, h, nextTick } from 'vue'
import '@vue-flow/core/dist/style.css'
import NodeGallery from './NodeGallery.vue'
import TextField from '@/features/node-ui/fields/TextField.vue'
import { galleryChecks } from './invariants'
import { galleryNodes } from './nodes'
import { listItems, findNodeItem, type EnumOption } from '@/lib/graph'
import { click } from '@/test/pointer'

let root: HTMLElement
let unmount: () => void
const complaints: string[] = []

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation((...args) => void complaints.push(args.join(' ')))
  vi.spyOn(console, 'warn').mockImplementation((...args) => void complaints.push(args.join(' ')))
  // room for the widest popup, Math's five columns, which the default test frame does not have
  await page.viewport(1400, 900)
  root = document.createElement('div')
  root.style.cssText = 'width: 1400px; height: 900px'
  document.body.append(root)
  const app = createApp(NodeGallery)
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  await vi.waitFor(() => expect(root.querySelector('[data-laid-out="true"]')).not.toBeNull(), { timeout: 20000 })
  await document.fonts.ready
  await new Promise((resolve) => setTimeout(resolve, 300))
})
afterAll(() => unmount())

const nodeEl = (id: string) => root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${id}"]`)!

describe('every registered node, expanded and collapsed', () => {
  it('mounts every kind twice without a console error or warning', () => {
    for (const item of listItems()) {
      expect(nodeEl(item.id)?.querySelector('.nui-content'), `${item.id} expanded`).not.toBeNull()
      expect(nodeEl(`${item.id}~collapsed`)?.querySelector('.nui-node.is-collapsed'), `${item.id} collapsed`).not.toBeNull()
    }
    expect(root.querySelectorAll('.vue-flow__node')).toHaveLength(galleryNodes().length)
    expect(complaints).toEqual([])
  })

  it('shows the sockets of the shape, not of the item: Math grows a third value for Wrap', () => {
    expect(nodeEl('math').querySelectorAll('.vue-flow__handle-left')).toHaveLength(2)
    expect(nodeEl('math:wrap').querySelectorAll('.vue-flow__handle-left')).toHaveLength(3)
    expect(nodeEl('math:wrap~collapsed').querySelectorAll('.nui-header .vue-flow__handle-left')).toHaveLength(3)
  })

  for (const [name, check] of Object.entries(galleryChecks)) {
    it(`${name}: none`, () => expect(check(root)).toEqual([]))
  }
})

// the checks above prove nothing unless they can fail, so each one is run against a kit broken in the way it exists to catch
describe('each check fails on a broken kit', () => {
  const broken: [check: keyof typeof galleryChecks, css: string, reports: string][] = [
    ['emptyNodes', '.nui-node { display: none }', 'math'],
    ['horizontalOverflow', '.nui-row.is-output .nui-label { margin-right: -30px }', 'leaves the node'],
    ['detachedSockets', '.vue-flow__handle-right.nui-socket { right: 12px }', 'off the right edge'],
    ['detachedSockets', '.nui-folded .vue-flow__handle.nui-socket { top: -30px }', 'sticks out of the folded header'],
    ['strayRangeFills', '.nui-range-fill { min-width: 3px }', 'is empty but paints'],
    ['clippedText', '.nui-implicit { text-overflow: clip; max-width: 3em }', 'cut without an ellipsis'],
    ['clippedText', '.nui-vector { flex-direction: row }', 'squeezed to under two characters'],
    ['clippedText', '.nui-label { height: 8px }', 'cut vertically'],
    ['overlappingSiblings', '.nui-range-text { margin-left: -12px }', 'overlaps the widget before it'],
    ['fieldSlivers', '.nui-text { padding-left: 6px }', 'strip of its field uncovered'],
    ['clippedFocusRings', '.nui-field :focus-visible { outline: 2px solid red }', 'focus ring its field cuts'],
  ]

  // no registered node has a text field without a label any more, so the sliver check gets one to look at
  let unlabelled: () => void
  beforeAll(() => {
    const host = Object.assign(document.createElement('div'), { className: 'vue-flow__node' })
    host.dataset.id = 'unlabelled-text'
    host.style.width = '160px'
    root.append(host)
    const app = createApp({ render: () => h('div', { class: 'nui nui-node' }, h(TextField, { modelValue: 'Screen' })) })
    app.mount(host)
    unlabelled = () => {
      app.unmount()
      host.remove()
    }
  })
  afterAll(() => unlabelled())

  for (const [check, css, reports] of broken) {
    it(`${check}: ${css}`, () => {
      const style = document.createElement('style')
      style.textContent = css
      document.head.append(style)
      try {
        expect(galleryChecks[check](root).join('\n')).toContain(reports)
      } finally {
        style.remove()
      }
    })
  }
})

describe('the enum popup inside a node', () => {
  const optionsOf = (kind: string, socket: string) =>
    findNodeItem(kind)!.base.inputs.find((s) => s.name === socket)!.type.props!.options as readonly EnumOption[]
  const popup = () => document.querySelector<HTMLElement>('.nui-dropdown-menu')
  // a popup left open by a failed case would be the one the next case finds
  afterEach(() => void document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))

  for (const [kind, socket, pick] of [
    ['math', 'op', 'Arctan2'],
    ['vectorMath', 'op', 'Cross Product'],
    ['layerMix', 'mode', 'Overlay'],
  ] as const) {
    it(`${kind}: one column per group, every option reachable, a click sets the value`, async () => {
      const options = optionsOf(kind, socket)
      const button = nodeEl(kind).querySelector<HTMLElement>('.nui-dropdown-button')!
      button.scrollIntoView({ block: 'center' })
      button.click()
      await expect.poll(() => popup()?.style.left).toBeTruthy()

      const menu = popup()!
      expect([...menu.querySelectorAll('[role=option]')].map((el) => el.textContent!.trim()).sort()).toEqual(options.map((o) => o.label).sort())
      expect([...menu.querySelectorAll('.nui-dropdown-heading')].map((el) => el.textContent!.trim())).toEqual([...new Set(options.map((o) => o.group))])
      expect(menu.scrollHeight, 'nothing to scroll').toBeLessThanOrEqual(menu.clientHeight)
      expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth)

      const box = menu.getBoundingClientRect()
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.top).toBeGreaterThanOrEqual(0)
      expect(box.right).toBeLessThanOrEqual(window.innerWidth)
      expect(box.bottom).toBeLessThanOrEqual(window.innerHeight)
      for (const option of menu.querySelectorAll('[role=option]')) {
        const rect = option.getBoundingClientRect()
        expect(
          document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
          `${option.textContent!.trim()} is not covered or clipped`,
        ).toBe(option)
      }

      await click([...menu.querySelectorAll('[role=option]')].find((el) => el.textContent!.trim() === pick)!)
      await nextTick()
      expect(popup()).toBeNull()
      expect(button.textContent!.trim()).toBe(pick)
    })
  }
})
