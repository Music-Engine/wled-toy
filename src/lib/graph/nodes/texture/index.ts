import type { NodeItem } from '@/lib/graph/authoring'
import { brickTextureNode } from './brick-texture'
import { checkerTextureNode } from './checker-texture'
import { gradientTextureNode } from './gradient-texture'
import { imageTextureNode } from './image-texture'
import { magicTextureNode } from './magic-texture'
import { noiseTextureNode } from './noise-texture'
import { voronoiNode } from './voronoi'
import { waveTextureNode } from './wave-texture'
import { whiteNoiseNode } from './white-noise'

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
