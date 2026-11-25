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
