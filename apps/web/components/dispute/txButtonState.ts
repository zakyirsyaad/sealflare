import type { TxState } from '../../lib/chain/useWriteTx'
import type { AttestState } from '../attest/useAttest'

const STATES: Record<TxState, AttestState> = {
  idle: 'idle',
  signing: 'signing-tx',
  pending: 'pending',
  failed: 'failed',
  done: 'done',
}

/** The state of a transaction as the button of an attestation names it. */
export const buttonStateOf = (state: TxState): AttestState => STATES[state]
