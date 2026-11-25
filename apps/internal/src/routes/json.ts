import type { Context } from 'hono'

/** The body of a request, or the reason it could not be read. */
export type JsonBody = { ok: true; value: unknown } | { ok: false }

/** Reads a JSON body. A body that is not JSON reads as a failure, so the route can answer 400. */
export async function readJson(c: Context): Promise<JsonBody> {
  try {
    return { ok: true, value: await c.req.json() }
  } catch {
    return { ok: false }
  }
}
