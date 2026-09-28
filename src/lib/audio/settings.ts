import { isMac, isTauri } from '@/lib/app/platform'
import { DEFAULT_ANALYZER, type AnalyzerConfig } from './dsp'

export type AudioSourceKind = 'file' | 'device' | 'loopback'
export type AudioChannel = 'mono' | 'left' | 'right'

/** Where the audio comes from and how its level is tamed. One of these is live at a time. */
export interface AudioSettings extends Pick<AnalyzerConfig, 'agc' | 'gate'> {
  source: AudioSourceKind
  /** `deviceId` from enumerateDevices, or '' for the system default. */
  deviceId: string
  channel: AudioChannel
}

/** What a graph's Audio Source asks for. Which device is captured is not part of it: devices differ per machine. */
export type AudioSourceRequest = Omit<AudioSettings, 'deviceId'>

/** How one FFT looks at the live source. Several can run side by side, e.g. a fast coarse one and a slow fine one. */
export type AnalysisSettings = Omit<AnalyzerConfig, 'sampleRate' | 'agc' | 'gate'>

const { agc, gate, ...DEFAULT_FFT } = DEFAULT_ANALYZER
export const DEFAULT_ANALYSIS: AnalysisSettings = DEFAULT_FFT
export const DEFAULT_AUDIO: AudioSettings = { agc, gate, source: 'file', deviceId: '', channel: 'mono' }

/** Why system audio cannot be captured here, or null when it can: WKWebView, the webview of the macOS desktop app, delivers no audio through getDisplayMedia. */
export const systemAudioBlocked = (): string | null =>
  isTauri() && isMac()
    ? 'System audio capture is not available in the desktop app yet. Route audio through a loopback device such as BlackHole and pick it as the capture device.'
    : null

/** The shader has this many sets of band and history textures. Slot 0 is always the default analysis. */
export const MAX_ANALYSES = 4
