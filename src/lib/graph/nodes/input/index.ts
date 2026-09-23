import type { NodeItem } from '@/lib/graph/define/shape'
import { uvNode } from './uv'
import { valueNode } from './value'
import { vector2Node } from './vector2'

export const INPUT_NODES: NodeItem[] = [
  uvNode,
  valueNode,
  vector2Node,
]
