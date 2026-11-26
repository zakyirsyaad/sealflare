import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { Activity, AddressSchema } from '@sealflare/shared/schemas'
import type { Db } from '../db'
import { fail, okWithMeta } from '../respond'
import { finalizedBlock, snapshot } from '../readModel/targets'
import { activityFor } from '../readModel/activity'

/**
 * The read route of the activity of one account.
 *
 * The answer holds what the account has to do, what it may withdraw, how it stands and what it
 * did. The deadlines are read at the moment the route is given, so the answer is the same for
 * every caller of that moment.
 */

const AddressParam = z.object({ address: AddressSchema })

export interface ActivityRouteDeps {
  sql: Db
  /** The moment the deadlines of the actions are read at. */
  now: () => Date
}

export function activityRoutes(deps: ActivityRouteDeps): Hono {
  const app = new Hono()
  app.get('/:address', (c) => handler(c, deps))
  return app
}

/** The activity of one account. */
async function handler(c: Context, deps: ActivityRouteDeps): Promise<Response> {
  const params = AddressParam.safeParse(c.req.param())
  if (!params.success) {
    return c.json(fail('BAD_REQUEST', 'The address of the account is not valid.'), 400)
  }
  const { activity, block } = await snapshot(deps.sql, async (tx) => {
    const found = await activityFor(tx, params.data.address, deps.now())
    return { activity: found, block: await finalizedBlock(tx) }
  })
  const parsed = Activity.safeParse(activity)
  if (!parsed.success) return c.json(fail('INTERNAL', 'The indexed activity cannot be read.'), 500)
  return c.json(okWithMeta(parsed.data, { finalizedBlock: block }))
}
