import type { GlslChunk } from '@/lib/graph/authoring'
import { AUDIO_READS } from '@/lib/shader/prelude'

/** What the audio bodies read: the prelude and the C++ header define it, so only a frame pass pastes it. */
export const audioReadsChunk: GlslChunk = { id: 'audio reads', requires: [], source: AUDIO_READS, inPrelude: true }
