import type { NodeItem } from '@/lib/graph/define/shape'
import { brickTextureNode } from './brick-texture'
import { checkerTextureNode } from './checker-texture'
import { gradientTextureNode } from './gradient-texture'
import { imageTextureNode } from './image-texture'
import { magicTextureNode } from './magic-texture'
import { noiseTextureNode } from './noise-texture'
import { voronoiNode, whiteNoiseNode } from './noise-textures'
import { waveTextureNode } from './wave-texture'

export const TEXTURE_NODES: NodeItem[] = [
  noiseTextureNode,
  whiteNoiseNode,
  voronoiNode,
  waveTextureNode,
  magicTextureNode,
  gradientTextureNode,
  checkerTextureNode,
  brickTextureNode,
  imageTextureNode,
]
