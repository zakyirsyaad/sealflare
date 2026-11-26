import { Hono } from 'hono'
import { createInterServiceAuth } from './auth'
import type { Db } from './db'
import { nonceRoutes } from './routes/nonce'
import { rateRoutes } from './routes/rate'
import { sandboxRoutes, type SandboxRouteDeps } from './routes/sandbox'
import { scanRoutes } from './routes/scans'
import { targetRoutes } from './routes/targets'
import { guardianRoutes } from './routes/guardians'
import { challengeRoutes } from './routes/challenges'
import { bountyRoutes } from './routes/bounties'
import { activityRoutes } from './routes/activity'
import type { SandboxVersion } from './readModel/caches'
import { fail } from './respond'

export interface AppDeps {
  sql: Db
  env: {
    internalKey: string
    /**
     * The probe set and the model the sandbox runs now.
     *
     * A clean sandbox result expires when either of them changes, so the target detail needs to
     * know which version is current. Without both of them no clean result is shown, because a
     * result of an unknown version cannot be called current.
     */
    sandboxProbeSetVersion?: string
    sandboxModelId?: string
  }
  now?: () => Date
  /** The sandbox is only mounted when the service was set up for it. */
  sandbox?: SandboxRouteDeps
  /** Writes one line per request. It never receives a body or a key. */
  log?: (line: string) => void
}

/** The only route that may be reached without the inter-service key. */
const OPEN_PATH = '/health'

/**
 * The sandbox version the service runs now, or null when it is not known.
 *
 * Both halves are needed. One half alone cannot say that a clean result is current, so a
 * service that knows only one of them shows no clean result.
 */
function sandboxVersion(env: AppDeps['env']): SandboxVersion | null {
  const probeSetVersion = env.sandboxProbeSetVersion
  const modelId = env.sandboxModelId
  if (!probeSetVersion || !modelId) return null
  return { probeSetVersion, modelId }
}

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
  app.route('/targets', targetRoutes({ sql: deps.sql, sandbox: sandboxVersion(deps.env) }))
  if (deps.sandbox !== undefined) app.route('/sandbox', sandboxRoutes(deps.sandbox))
  app.route('/guardians', guardianRoutes({ sql: deps.sql }))
  app.route('/challenges', challengeRoutes({ sql: deps.sql, now }))
  app.route('/bounties', bountyRoutes({ sql: deps.sql }))
  app.route('/activity', activityRoutes({ sql: deps.sql, now }))

  app.notFound((c) => c.json(fail('BAD_REQUEST', 'There is no such route.'), 404))
  app.onError((error, c) => {
    console.error('internal service failed', error)
    return c.json(fail('INTERNAL', 'The request could not be completed.'), 500)
  })

  return app
}
