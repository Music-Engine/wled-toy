import type { NodeItem } from '@/lib/graph/authoring'
import { audioNode, audioSourceNode, bandSplitNode, fftNode } from './audio'
import { audioSignalNode } from './audio-signal'
import { bandsNode } from './bands'
import { chromaNode, spectrumNode, waveformNode } from './samplers'

export const AUDIO_NODES: NodeItem[] = [
  audioSourceNode,
  fftNode,
  audioNode,
  audioSignalNode,
  bandsNode,
  bandSplitNode,
  spectrumNode,
  waveformNode,
  chromaNode,
]
