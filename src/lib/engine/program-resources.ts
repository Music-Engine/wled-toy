import { log } from '@/lib/app/logs'
import type { AudioService } from '@/lib/audio/service'
import type { AnalysisSettings, AudioSourceRequest } from '@/lib/audio/settings'
import { MAX_SPECTRUM_BINS } from '@/lib/audio/textures'
import type { Bridge } from '@/lib/bridge/bridge-client'
import type { GlslProgram } from '@/lib/graph'
import { AUDIO_EXTRA_SLOTS } from '@/lib/shader/prelude'
import { stripComments } from '@/lib/shader/shader-bundle'
import type { EngineMedia } from '@/lib/engine/media/engine-media'
import type { MidiService } from './midi'

interface ResourceHost {
  audio: AudioService
  media: EngineMedia
  bridge: Bridge
  midi: MidiService
  spectraWidth: number
}

/** Audio source and analyses, images, OSC port, MIDI; warns when the GPU holds fewer spectrum bins than Band Split reads */
export function openProgramResources({ resources, uniforms }: GlslProgram, host: ResourceHost) {
  const read = <T>(kind: string) => (resources[kind] ?? []) as T[]
  // First Audio Source wins
  const [source] = read<AudioSourceRequest>('audioSource')
  if (source) void host.audio.configure(source)
  host.audio.setAnalyses(read<AnalysisSettings>('analysis'))
  void host.media.showImages(read<string>('image'))
  const [oscPort = 0] = read<number>('osc')
  host.bridge.listenOsc(oscPort)
  // MIDI shows a permission prompt, so only once a graph uses it
  if (uniforms.some((uniform) => uniform.kind === 'midi')) void host.midi.enable()
  if (resources.spectra && host.spectraWidth < MAX_SPECTRUM_BINS) {
    log(`This GPU holds ${host.spectraWidth} of ${MAX_SPECTRUM_BINS} spectrum bins; Band Split misses the frequencies above them`, 'warn')
  }
}

/** Audio reads of a hand-written shader, by name, as graph nodes declare them */
export function readShaderResources(source: string): Record<string, unknown[]> {
  const code = stripComments(source)
  return {
    ...(/\biAudioFeatures\b/.test(code) ? { audioFeatures: [true] } : {}),
    ...(/\b(iAudioSpectra|spectrumPeak)\b/.test(code) ? { spectra: Array.from({ length: AUDIO_EXTRA_SLOTS + 1 }, (_, slot) => slot) } : {}),
  }
}
