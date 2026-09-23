import type { NodeItem } from '@/lib/graph/define/shape'
import { clockDividerNode } from './clock-divider'
import { counterNode, toggleNode } from './counter'
import { curveNode } from './curve'
import { envelopeNode } from './envelope'
import { envelopeFollowerNode } from './envelope-follower'
import { integratorNode } from './integrator'
import { mapRangeNode } from './map-range'
import { peakHoldNode } from './peak-hold'
import { randomNode } from './random'
import { sampleHoldNode } from './sample-hold'
import { schmittTriggerNode } from './schmitt-trigger'
import { slewLimiterNode } from './slew-limiter'
import { stepSequencerNode } from './step-sequencer'
import { viewerNode } from './viewer'
import { waveNode } from './wave'

export const SIGNAL_NODES: NodeItem[] = [
  mapRangeNode,
  curveNode,
  randomNode,
  waveNode,
  integratorNode,
  viewerNode,
  envelopeFollowerNode,
  peakHoldNode,
  slewLimiterNode,
  schmittTriggerNode,
  envelopeNode,
  sampleHoldNode,
  counterNode,
  toggleNode,
  clockDividerNode,
  stepSequencerNode,
]
