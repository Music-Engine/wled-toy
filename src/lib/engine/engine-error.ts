export type EngineErrorCode =
  | 'webgl-unavailable'
  | 'state-outputs'
  | 'no-float-targets'
  | 'shader-create'
  | 'shader-compile'
  | 'shader-link'
  | 'image-fetch'
  | 'not-an-image'
  | 'media-store'
  | 'layout-json'

/** Renderer, image or media failure; callers switch on `code`, the user reads the message */
export class EngineError extends Error {
  override readonly name = 'EngineError'

  constructor(
    readonly code: EngineErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
  }
}
