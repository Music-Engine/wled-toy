import type { NodeItem } from '@/lib/graph/authoring'
import { clockDividerNode } from './triggers/clock-divider'
import { counterNode, toggleNode } from './triggers/counter'
import { curveNode } from './curve'
import { envelopeNode } from './triggers/envelope'
import { envelopeFollowerNode } from './smoothing/envelope-follower'
import { integratorNode } from './integrator'
import { mapRangeNode } from './map-range'
import { peakHoldNode } from './smoothing/peak-hold'
import { randomNode } from './random'
import { sampleHoldNode } from './triggers/sample-hold'
import { schmittTriggerNode } from './triggers/schmitt-trigger'
import { slewLimiterNode } from './smoothing/slew-limiter'
import { stepSequencerNode } from './triggers/step-sequencer'
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
