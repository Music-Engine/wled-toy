export type NativeErrorCode = 'menu-sync'

/** A desktop shell call that failed. `code` is what callers switch on; the message is what the user reads. */
export class NativeError extends Error {
  override readonly name = 'NativeError'

  constructor(readonly code: NativeErrorCode, message: string, override readonly cause?: unknown) {
    super(message)
  }
}
