import { Hono } from 'hono'
import { createInterServiceAuth } from './auth'
import type { Db } from './db'
import { nonceRoutes } from './routes/nonce'
import { rateRoutes } from './routes/rate'
import { sandboxRoutes, type SandboxRouteDeps } from './routes/sandbox'
import { scanRoutes } from './routes/scans'
import { fail } from './respond'

export interface AppDeps {
  sql: Db
  env: { internalKey: string }
  now?: () => Date
  /** The sandbox is only mounted when the service was set up for it. */
  sandbox?: SandboxRouteDeps
  /** Writes one line per request. It never receives a body or a key. */
  log?: (line: string) => void
}

/** The only route that may be reached without the inter-service key. */
const OPEN_PATH = '/health'

/**
 * The internal service. It is the only door to Postgres, so every route but the health check
 * needs the inter-service key. The key is checked before anything else runs, so a request
 * without it never reaches a route and never reads anything.
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  const now = deps.now ?? (() => new Date())
  const auth = createInterServiceAuth(deps.env.internalKey)

  app.use('*', async (c, next) => {
    const started = Date.now()
    await next()
    deps.log?.(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - started}ms`)
  })

  app.use('*', async (c, next) => {
    if (c.req.path === OPEN_PATH) return next()
    return auth(c, next)
  })

  app.get(OPEN_PATH, (c) => c.json({ status: 'ok' }))

  app.route('/rate', rateRoutes({ sql: deps.sql, now }))
  app.route('/nonce', nonceRoutes({ sql: deps.sql, now }))
  app.route('/scans', scanRoutes({ sql: deps.sql }))
  if (deps.sandbox !== undefined) app.route('/sandbox', sandboxRoutes(deps.sandbox))

  app.notFound((c) => c.json(fail('BAD_REQUEST', 'There is no such route.'), 404))
  app.onError((error, c) => {
    console.error('internal service failed', error)
    return c.json(fail('INTERNAL', 'The request could not be completed.'), 500)
  })

  return app
}
