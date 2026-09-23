import type { NodeItem } from '@/lib/graph/define/shape'
import { previousFrameNode, stripBlurNode, trailsNode } from './feedback'
import { fromCenterNode } from './from-center'
import { ledLayoutNode } from './led-layout'
import { mappingNode } from './mapping'
import { rangeSelectNode } from './range-select'
import { mirrorNode, polarNode, rotateNode, segmentSplitNode, tileNode } from './transforms'

export const SPATIAL_NODES: NodeItem[] = [
  ledLayoutNode,
  trailsNode,
  stripBlurNode,
  previousFrameNode,
  mappingNode,
  polarNode,
  mirrorNode,
  tileNode,
  rotateNode,
  segmentSplitNode,
  rangeSelectNode,
  fromCenterNode,
]
