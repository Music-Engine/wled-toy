import type { NodeItem } from '@/lib/graph/define/shape'
import { AUDIO_NODES } from './audio'
import { COLOR_NODES } from './color'
import { CONTROL_NODES } from './control'
import { CONVERTER_NODES } from './converter'
import { INPUT_NODES } from './input'
import { OUTPUT_NODES } from './output'
import { SIGNAL_NODES } from './signal'
import { SPATIAL_NODES } from './spatial'
import { TEXTURE_NODES } from './texture'

export const NODE_KINDS: NodeItem[] = [
  ...AUDIO_NODES,
  ...COLOR_NODES,
  ...CONTROL_NODES,
  ...CONVERTER_NODES,
  ...INPUT_NODES,
  ...OUTPUT_NODES,
  ...SIGNAL_NODES,
  ...SPATIAL_NODES,
  ...TEXTURE_NODES,
]
