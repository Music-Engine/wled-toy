import { commands } from 'vitest/browser'
import { BEAT, FPS, findSection } from '@/lib/graph/testing/offline'
import type { Run } from './run'

export const writePng = (path: string, canvas: HTMLCanvasElement) => commands.writeFile(path, canvas.toDataURL('image/png').split(',')[1], 'base64')

/** Row per frame, time downward, music in a left gutter so rows match it */
export function drawTimeline(run: Run, rows: Float32Array[], caption: string): HTMLCanvasElement {
  const [left, top, rowHeight] = [160, 30, 3]
  const columns = rows[0].length / 3
  const cell = Math.round(720 / columns)
  const { canvas, ctx } = createSheet(left + columns * cell, top + rows.length * rowHeight)
  ctx.fillStyle = '#ddd'
  ctx.fillText(caption, left, 2)
  ctx.fillText('time', 0, 16)
  ctx.fillText('kick', 56, 16)
  ctx.fillText('level', 90, 16)
  ctx.fillText('beat', 128, 16)
  const all = new Float32Array(rows.length * columns * 3)
  rows.forEach((row, frame) => all.set(row, frame * columns * 3))
  ctx.drawImage(drawLedImage(all, columns), left, top, columns * cell, rows.length * rowHeight)
  run.audio.forEach((audio, frame) => drawGutterRow(ctx, audio, frame, top + frame * rowHeight, rowHeight))
  return canvas
}

export function drawMatrixSheet(run: Run, matrixSide: number): HTMLCanvasElement {
  const [columns, scale, label, gap] = [4, 5, 14, 8]
  const tile = matrixSide * scale
  const { canvas, ctx } = createSheet(gap + columns * (tile + gap), gap + 4 * (tile + label + gap))
  Array.from({ length: 16 }, (_, i) => Math.round((0.57 + i * 0.6) * FPS)).forEach((frame, i) => {
    const t = frame / FPS
    const x = gap + (i % columns) * (tile + gap)
    const y = gap + Math.floor(i / columns) * (tile + label + gap)
    const note = findSection(t) === 'breakdown' ? 'breakdown' : `${findSection(t)}${t % BEAT < 0.1 ? ' KICK' : ''}`
    ctx.fillStyle = '#ddd'
    ctx.fillText(`${t.toFixed(2)}s ${note}`, x, y)
    ctx.drawImage(drawLedImage(run.matrix[frame], matrixSide), x, y + label, tile, tile)
  })
  return canvas
}

function drawGutterRow(ctx: CanvasRenderingContext2D, audio: Run['audio'][number], frame: number, y: number, rowHeight: number) {
  const t = frame / FPS
  const drawBar = (x: number, width: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(x, y, width, rowHeight)
  }
  if (frame % FPS === 0) {
    ctx.fillStyle = '#ddd'
    ctx.fillText(`${t}s`, 0, y)
  }
  drawBar(30, 8, { groove: '#555', breakdown: '#2060ff', drop: '#ff30a0' }[findSection(t)])
  if (findSection(t) !== 'breakdown' && t % BEAT < 1.5 / FPS) drawBar(42, 8, Math.floor(t / BEAT) % 2 === 1 ? '#30e0ff' : '#ff9020')
  drawBar(56, Math.round(audio.kick * 30), '#e03030')
  drawBar(90, Math.round(audio.level * 30), '#30c040')
  if (audio.beat) drawBar(134, 10, '#fff')
}

function createSheet(width: number, height: number) {
  const canvas = Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#181818'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = false
  ctx.font = '11px monospace'
  ctx.textBaseline = 'top'
  return { canvas, ctx }
}

/** r, g, b floats per LED, `width` to a row from the top left */
function drawLedImage(leds: Float32Array, width: number): HTMLCanvasElement {
  const canvas = Object.assign(document.createElement('canvas'), { width, height: leds.length / 3 / width })
  const image = new ImageData(canvas.width, canvas.height)
  for (let i = 0; i < leds.length / 3; i++) {
    for (let channel = 0; channel < 3; channel++) image.data[i * 4 + channel] = Math.round(Math.min(1, Math.max(0, leds[i * 3 + channel])) * 255)
    image.data[i * 4 + 3] = 255
  }
  canvas.getContext('2d')!.putImageData(image, 0, 0)
  return canvas
}
