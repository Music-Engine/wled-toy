export type BridgeErrorCode = 'link-failed'

/** A link to the UDP bridge that broke. `code` is what callers switch on; the message is what the user reads. */
export class BridgeError extends Error {
  override readonly name = 'BridgeError'

  constructor(
    readonly code: BridgeErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
  }
}
