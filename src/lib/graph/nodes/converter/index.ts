import type { NodeItem } from '@/lib/graph/define/shape'
import { clampNode } from './clamp'
import { mathNode } from './math'
import { mixNode } from './mix'
import { vectorMathNode } from './vector-math'
import { combineXyzNode, separateXyzNode } from './xyz'

export const CONVERTER_NODES: NodeItem[] = [
  mathNode,
  vectorMathNode,
  mixNode,
  clampNode,
  combineXyzNode,
  separateXyzNode,
]
