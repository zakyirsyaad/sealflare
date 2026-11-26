import { WorkerRunStatus } from '@sealflare/shared/schemas'

/** A live smoke is successful only after its result and public upload are both persisted. */
export function completedSmoke(input: unknown, uploadStatus: number | undefined): WorkerRunStatus {
  const status = WorkerRunStatus.parse(input)
  if (status.state !== 'done' || !uploadStatus || uploadStatus < 200 || uploadStatus >= 300
    || !status.evidenceURI || !/^ipfs:\/\/[A-Za-z0-9]+$/.test(status.evidenceURI)) {
    throw Error('Smoke result or evidence upload is incomplete.')
  }
  return status
}
