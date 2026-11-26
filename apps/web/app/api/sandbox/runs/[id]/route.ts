import { fail, failUnexpected, ok } from '../../../../../server/respond'
import { internalRead, InternalServiceError } from '../../../../../server/internal'

/**
 * The state of a run.
 *
 * The run is read from the internal service, which is the only door to the queue. A run that does
 * not exist is a 404 and never an empty state, so a screen can tell "no run yet" from "the run is
 * gone".
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  if (!/^run_[0-9a-f]{24}$/.test(id)) {
    return fail('BAD_REQUEST', 'The run id is not a run id.', 400)
  }
  try {
    const answer = await internalRead<unknown>(`/sandbox/runs/${id}`)
    return ok(answer.data)
  } catch (error) {
    if (error instanceof InternalServiceError) {
      if (error.code === 'RUN_NOT_FOUND') return fail('RUN_NOT_FOUND', 'There is no such run.', 404)
      return fail(error.code, error.message, 500)
    }
    return failUnexpected('The sandbox run could not be read.', error)
  }
}
