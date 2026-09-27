import { layoutPositions } from '@/lib/engine/output/layout'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { Runtime } from '@/lib/engine/runtime'
import type { GlslProgram, SlotTable } from '@/lib/graph/compile/compilers'
import { PREVIEW_SIZE, TARGETS } from './config'

export interface Targets {
  /** One per TARGETS entry, same order */
  leds: { renderer: ShaderRenderer; runtime: Runtime }[]
  preview: ShaderRenderer
  canvas: HTMLCanvasElement
  /** Waits until the preview has drawn */
  finishPreview: () => void
}

export function openTargets(program: GlslProgram, table: SlotTable): Targets {
  const leds = TARGETS.map((target) => {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    const runtime = new Runtime(renderer)
    runtime.load(program, table)
    if (target.layout) renderer.setLayout(layoutPositions({ segments: [{ kind: 'matrix', width: target.layout, height: target.layout, serpentine: false, origin: 'top-left' }] }))
    return { renderer, runtime }
  })
  const canvas = createPreviewCanvas()
  const preview = new ShaderRenderer(canvas)
  new Runtime(preview).load(program, table)
  const previewGl = canvas.getContext('webgl2')
  const pixel = new Uint8Array(4)
  // gl.finish() alone returns before SwiftShader has drawn; a one-pixel readback is a sync point it can't defer
  const finishPreview = () => {
    previewGl?.readPixels(0, 0, 1, 1, previewGl.RGBA, previewGl.UNSIGNED_BYTE, pixel)
    previewGl?.finish()
  }
  return { leds, preview, canvas, finishPreview }
}

export function closeTargets({ leds, preview, canvas }: Targets) {
  for (const { renderer } of leds) renderer.dispose()
  preview.dispose()
  canvas.remove()
}

/** Attached, so renderPreview gets a real size, not an unattached 0x0 */
function createPreviewCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.style.width = `${PREVIEW_SIZE[0]}px`
  canvas.style.height = `${PREVIEW_SIZE[1]}px`
  document.body.appendChild(canvas)
  return canvas
}
