import type { GlslChunk } from '@/lib/graph/authoring'
import { AUDIO_READS } from '@/lib/shader/prelude'

/** Defined by prelude and C++ header, so only a frame pass pastes it */
export const audioReadsChunk: GlslChunk = { id: 'audio reads', requires: [], source: AUDIO_READS, inPrelude: true }
