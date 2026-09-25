export type EngineErrorCode = 'webgl-unavailable' | 'state-outputs' | 'no-float-targets' | 'shader-create' | 'shader-compile' | 'shader-link' | 'image-fetch' | 'not-an-image' | 'media-store'

/** A renderer, image or media failure. `code` is what callers switch on; the message is what the user reads. */
export class EngineError extends Error {
  override readonly name = 'EngineError'

  constructor(readonly code: EngineErrorCode, message: string, override readonly cause?: unknown) {
    super(message)
  }
}
