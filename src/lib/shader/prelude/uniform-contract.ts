import { AUDIO_BINS, HISTORY_ROWS, MAX_SPECTRUM_BINS, WAVE_ROWS, WAVE_WIDTH } from '@/lib/audio/textures'
import { AUDIO_EXTRA_SLOTS, CONTROL_VECTORS, IMAGE_LAYERS, IMAGE_LAYER_SIZE } from './uniforms'

/** What a host feeds each prelude uniform; a bundle's header quotes the ones it declares */
export const UNIFORM_CONTRACT: Record<string, string> = {
  iResolution: 'size of the render target in pixels as (width, height, 1). A target one pixel high is the LED pass: one pixel per LED, in wire order.',
  iTime: 'seconds since the animation started.',
  iFrame: 'frame counter, from 0.',
  iLedCount: 'number of LEDs on the strip.',
  iScanY: 'which row of the 2D picture the LED pass samples, 0 (bottom) to 1 (top). Only read when there is no LED layout.',
  iAudio: `R8 texture, ${AUDIO_BINS} x 2, linear filtering, clamped. Row 0: FFT magnitudes 0 to 1, lowest frequency first. Row 1: the waveform, 0.5 is silence.`,
  iImage: 'RGBA8 image of any size, linear filtering, clamped, first row at the top (the helpers flip y).',
  iImages: `RGBA8 2D array texture, ${IMAGE_LAYERS} layers of ${IMAGE_LAYER_SIZE} x ${IMAGE_LAYER_SIZE}, linear filtering, clamped: one image per layer.`,
  iAudioBands:
    'R8 texture, N x 2 with N at least 12, linear filtering, clamped. Row 0: N band levels 0 to 1 (log or mel spaced), bass first. Row 1: the 12 pitch classes from C in texels 0 to 11.',
  iAudioHistory: `R8 texture, N x ${HISTORY_ROWS}, linear filtering, clamped in x and repeating in y: one row of band levels per analysis hop, written as a ring. iAudioHeads.x is the newest row.`,
  iAudioBandsExtra: `${AUDIO_EXTRA_SLOTS} more textures shaped like iAudioBands, for analyses with other settings (slots 1 to ${AUDIO_EXTRA_SLOTS}). Every element needs a texture unit of its own.`,
  iAudioHistoryExtra: `${AUDIO_EXTRA_SLOTS} more textures shaped like iAudioHistory, one per extra analysis. Every element needs a texture unit of its own.`,
  iAudioHistoryHeadExtra: 'the newest row of each iAudioHistoryExtra texture.',
  iAudioSpectra: `R32F texture, ${MAX_SPECTRUM_BINS} x ${AUDIO_EXTRA_SLOTS + 1}, nearest filtering: each analysis's linear spectrum as levels 0 to 1, a row per slot from 0, lowest frequency first.`,
  iAudioSpectrumBins: `${AUDIO_EXTRA_SLOTS + 1} floats: how many bins of each row of iAudioSpectra hold the spectrum, half the analysis's window.`,
  iAudioWave: `R8 texture, ${WAVE_WIDTH} x ${WAVE_ROWS}, repeating in y: the most recent samples as a ring in row-major order, 128 is silence.`,
  iAudioHeads: '(newest row of iAudioHistory, index of the next sample to be written to iAudioWave, sample rate in Hz).',
  iAudioFeatures:
    "4 vec4 of the default analysis's features for this frame, four to a vector: level, rms, peak, gate, onset, beat, beat phase, BPM, brightness, noisiness, then the sub, kick, low mid, vocal, presence and air levels. Onset and beat are 1 when the analysis raised them since the previous frame.",
  iLayout: 'RGBA32F texture, iLayoutCount x 1, nearest filtering: x, y, z (0 to 1) and segment index of every LED in wire order.',
  iLayoutCount: 'number of LEDs in iLayout, or 0 for a plain strip that samples the row at iScanY.',
  iPrevFrame: 'what this shader drew into the same target on the previous frame (render to two targets in turn), linear filtering, clamped.',
  iTimeDelta: 'seconds since the previous frame of the same target.',
  iControl: `${CONTROL_VECTORS} vec4 of values that WLEDtoy's graph mode computes on the CPU every frame; slot k is iControl[k / 4][k % 4]. This file does not carry what computes them: a host that cannot supply them leaves them at 0.`,
}
