import { ChallengeDetail, UintStringSchema } from '@sealflare/shared/schemas'
import { fail } from '../../../../server/respond'
import { readOne } from '../../../../server/read'

/**
 * One dispute, with its jury and its payouts.
 *
 * The direction of a vote is only known after the juror revealed it. During the commit phase
 * every direction stays empty, whatever the rows of the index hold, so a reader never learns
 * how a juror voted before the reveal.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params
  const parsed = UintStringSchema.safeParse(id)
  if (!parsed.success) return fail('BAD_REQUEST', 'The id of the dispute is not a whole number.', 400)
  return readOne({
    path: `/challenges/${parsed.data}`,
    data: ChallengeDetail,
    message: 'The indexed dispute cannot be read.',
    notFound: 'There is no such dispute.',
    prepare: hideTheVotesOfTheCommitPhase,
  })
}

/**
 * Takes the direction of every vote away while the dispute is in the commit phase.
 *
 * The phase is the one the answer names, so a dispute that the chain already closed keeps the
 * directions of the votes that were revealed.
 */
function hideTheVotesOfTheCommitPhase(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const challenge = value as { phase?: unknown; jurors?: unknown }
  if (challenge.phase !== 'COMMIT') return value
  if (!Array.isArray(challenge.jurors)) return value
  return {
    ...challenge,
    jurors: challenge.jurors.map((juror) => {
      if (juror === null || typeof juror !== 'object' || Array.isArray(juror)) return juror
      return { ...(juror as Record<string, unknown>), uphold: null }
    }),
  }
}
