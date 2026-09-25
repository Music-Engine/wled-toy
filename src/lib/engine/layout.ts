import { EngineError } from './engine-error'

/** Where each LED sits, in the 0..1 space the shader draws in (x right, y up), in wire order. */
export type Segment =
  | { kind: 'strip'; count: number; from: [number, number]; to: [number, number] }
  | { kind: 'ring'; count: number; center: [number, number]; radius: number; startAngle: number; clockwise: boolean }
  | { kind: 'matrix'; width: number; height: number; serpentine: boolean; origin: 'top-left' | 'bottom-left' }
  | { kind: 'points'; points: number[][] }

export interface Layout {
  segments: Segment[]
}

export const segmentCount = (segment: Segment) =>
  (segment.kind === 'matrix' ? segment.width * segment.height : segment.kind === 'points' ? segment.points.length : segment.count)

export const layoutCount = (layout: Layout) => layout.segments.reduce((sum, segment) => sum + segmentCount(segment), 0)

/** Whether the LEDs only run along lines, so a row of lights shows the device as it is; no layout is a single strip. */
export const isStripLayout = (layout: Layout | null) => !layout || layout.segments.every((segment) => segment.kind === 'strip')

function segmentPositions(segment: Segment): number[][] {
  if (segment.kind === 'points') return segment.points.map(([x = 0, y = 0, z = 0]) => [x, y, z])
  if (segment.kind === 'strip') {
    // LEDs sit at the centers of equal cells, so a strip from 0 to 1 matches the shader's own pixel centers
    return Array.from({ length: segment.count }, (_, i) => {
      const t = (i + 0.5) / segment.count
      return [segment.from[0] + (segment.to[0] - segment.from[0]) * t, segment.from[1] + (segment.to[1] - segment.from[1]) * t, 0]
    })
  }
  if (segment.kind === 'ring') {
    return Array.from({ length: segment.count }, (_, i) => {
      const angle = segment.startAngle + (segment.clockwise ? -1 : 1) * (i / segment.count) * 2 * Math.PI
      return [segment.center[0] + segment.radius * Math.cos(angle), segment.center[1] + segment.radius * Math.sin(angle), 0]
    })
  }
  return Array.from({ length: segment.width * segment.height }, (_, i) => {
    const row = Math.floor(i / segment.width)
    const along = i % segment.width
    // a serpentine matrix is one strip folded back and forth, so every other row runs right to left
    const column = segment.serpentine && row % 2 === 1 ? segment.width - 1 - along : along
    const y = (row + 0.5) / segment.height
    return [(column + 0.5) / segment.width, segment.origin === 'top-left' ? 1 - y : y, 0]
  })
}

/** x, y, z and segment index per LED, the float texture the renderer uploads. */
export function layoutPositions(layout: Layout): Float32Array {
  const out: number[] = []
  layout.segments.forEach((segment, index) => segmentPositions(segment).forEach((p) => out.push(p[0], p[1], p[2], index)))
  return Float32Array.from(out)
}

const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 4096

function isSegment(raw: unknown): raw is Segment {
  const s = raw as Record<string, unknown> | null
  if (!s) return false
  if (s.kind === 'strip') return isCount(s.count) && isPair(s.from) && isPair(s.to)
  if (s.kind === 'ring') return isCount(s.count) && isPair(s.center) && Number.isFinite(s.radius) && Number.isFinite(s.startAngle) && typeof s.clockwise === 'boolean'
  if (s.kind === 'matrix') return isCount(s.width) && isCount(s.height) && typeof s.serpentine === 'boolean' && (s.origin === 'top-left' || s.origin === 'bottom-left')
  if (s.kind === 'points') return Array.isArray(s.points) && s.points.length > 0 && s.points.every((p) => Array.isArray(p) && p.length >= 2 && p.length <= 3 && p.every(Number.isFinite))
  return false
}

/** A layout from untrusted JSON (an imported config, a pasted points list), or null when it is not one. */
export function parseLayout(raw: unknown): Layout | null {
  const segments = (raw as Layout | null)?.segments
  if (!Array.isArray(segments) || segments.length === 0 || !segments.every(isSegment)) return null
  const layout = { segments }
  return layoutCount(layout) <= 4096 ? layout : null
}

/** What the device form offers: no layout is a strip, a lone ring or matrix segment is that preset, anything else is custom JSON. */
export type LayoutKind = 'strip' | 'ring' | 'matrix' | 'custom'

/** The segment the ring and matrix presets edit, when the layout has exactly one. */
export function onlySegment(layout: Layout | null): Segment | null {
  const segments = layout?.segments ?? []
  return segments.length === 1 ? segments[0] : null
}

export function layoutKind(layout: Layout | null): LayoutKind {
  if (!layout) return 'strip'
  const only = onlySegment(layout)
  return only?.kind === 'ring' || only?.kind === 'matrix' ? only.kind : 'custom'
}

export function layoutSummary(layout: Layout | null): string {
  if (!layout) return 'A straight strip sampled along the scan row of the preview.'
  const only = onlySegment(layout)
  if (only?.kind === 'ring') return `A ring of ${only.count} LEDs.`
  if (only?.kind === 'matrix') return `A ${only.width} by ${only.height} matrix, ${layoutCount(layout)} LEDs. The LED count follows it.`
  return `${layout.segments.length} ${layout.segments.length === 1 ? 'segment' : 'segments'}, ${layoutCount(layout)} LEDs. The LED count follows it.`
}

/** The layout a preset starts from: a ring keeps the device's LED count, a matrix starts at 8 by 8. */
export function presetLayout(kind: Exclude<LayoutKind, 'custom'>, ledCount: number): Layout | null {
  if (kind === 'strip') return null
  if (kind === 'ring') return { segments: [{ kind: 'ring', count: ledCount, center: [0.5, 0.5], radius: 0.4, startAngle: Math.PI / 2, clockwise: true }] }
  return { segments: [{ kind: 'matrix', width: 8, height: 8, serpentine: true, origin: 'top-left' }] }
}

/** A layout typed as JSON; the error message is what the form shows under the field. */
export function parseLayoutJson(text: string): Layout {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new EngineError('layout-json', `Not JSON: ${(e as Error).message}`, e)
  }
  const layout = parseLayout(raw)
  if (!layout) throw new EngineError('layout-json', 'Not a layout: expected { "segments": [strip | ring | matrix | points] } with at most 4096 LEDs.')
  return layout
}
