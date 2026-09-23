import type { NodeItem } from '@/lib/graph/define/shape'
import { knobNode } from './knob'
import { midiInNode, oscInNode } from './midi-osc'
import { sceneSwitchNode } from './scene-switch'
import { timeNode } from './time'

export const CONTROL_NODES: NodeItem[] = [
  timeNode,
  knobNode,
  midiInNode,
  oscInNode,
  sceneSwitchNode,
]
