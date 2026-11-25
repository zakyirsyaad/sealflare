/** Every public answer is an envelope: either `data` or `error`, never both. */
export type ResponseMeta = { finalizedBlock?: string; page?: { total: number; page: number; limit: number } }

export function ok<T>(data: T, meta?: ResponseMeta): Response {
  return Response.json({ success: true, data, ...(meta === undefined ? {} : { meta }) })
}

export function fail(code: string, message: string, status: number, details?: unknown): Response {
  return Response.json(
    { success: false, error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status },
  )
}

/**
 * An unexpected failure is logged on the server before the envelope goes out. Without the log a
 * misconfigured deployment, such as one without the scanner variable, answers every scan with the
 * same envelope and leaves no trace of the cause.
 *
 * A configuration error names the variables that are missing, and that message goes to the log.
 * Every other failure is logged by its kind alone, because the message of an error from elsewhere
 * may name an endpoint or a key.
 */
export function failUnexpected(message: string, error: unknown): Response {
  console.error('The request could not be completed.', describe(error))
  return fail('INTERNAL', message, 500)
}

/** The message of a configuration error, which names variables and never values, or the kind of any other error. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'
  if (/^Invalid environment variables: /.test(error.message)) return error.message
  return error.name
}
