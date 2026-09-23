import type { NodeItem } from '@/lib/graph/define/shape'
import { brightnessContrastNode, gammaNode, invertNode } from './adjust'
import { colorNode } from './color'
import { colorMixNode } from './color-mix'
import { colorRampNode } from './color-ramp'
import { brightnessCeilingNode, layerMixNode, maskNode } from './composite'
import { hsvToRgbNode, hueSaturationNode, rgbToHsvNode } from './hsv'
import { paletteNode } from './palette'
import { combineColorNode, separateColorNode } from './separate-combine'

export const COLOR_NODES: NodeItem[] = [
  colorNode,
  colorMixNode,
  layerMixNode,
  maskNode,
  colorRampNode,
  paletteNode,
  hueSaturationNode,
  brightnessCeilingNode,
  brightnessContrastNode,
  gammaNode,
  invertNode,
  hsvToRgbNode,
  rgbToHsvNode,
  separateColorNode,
  combineColorNode,
]
