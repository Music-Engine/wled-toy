export interface FrameAudio {
  level: number
  kick: number
  /** Raised on some hop since prev frame, as the frame pass reads it */
  beat: boolean
  bands: Float32Array
  chroma: Float32Array
}

export interface Run {
  strip: Float32Array[]
  matrix: Float32Array[]
  audio: FrameAudio[]
}
