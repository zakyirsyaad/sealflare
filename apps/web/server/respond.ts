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
 * same envelope and leaves no trace of the cause. Only the message is logged: it names the missing
 * variables, never their values.
 */
export function failUnexpected(message: string, error: unknown): Response {
  console.error('The request could not be completed.', error instanceof Error ? error.message : error)
  return fail('INTERNAL', message, 500)
}
