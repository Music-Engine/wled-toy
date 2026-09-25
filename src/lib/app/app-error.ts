export type AppErrorCode = 'thrown-value' | 'storage-reset'

/** A failure of the app shell. `code` is what callers switch on; the message is what the user reads. */
export class AppError extends Error {
  override readonly name = 'AppError'

  constructor(readonly code: AppErrorCode, message: string, override readonly cause?: unknown) {
    super(message)
  }
}
