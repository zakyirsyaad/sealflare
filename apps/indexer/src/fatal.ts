/**
 * A failure that reading the same range again will not fix.
 *
 * The indexer stops on it, with a non-zero exit code, so the restart policy or the alert of
 * whoever runs it fires. A failure that is only an RPC blip is retried instead, because the same
 * range may still be read a moment later.
 */
export class FatalIndexError extends Error {
  override readonly name = 'FatalIndexError'
}
