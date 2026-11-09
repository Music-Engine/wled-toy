export type DocumentErrorCode = 'file-gone' | 'permission-denied' | 'bad-recent-list' | 'handle-not-kept'

/** A file action that could not go through. `code` is what callers switch on; the message is what the user reads. */
export class DocumentError extends Error {
  override readonly name = 'DocumentError'

  constructor(
    readonly code: DocumentErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
  }
}
