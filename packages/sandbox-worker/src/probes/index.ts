import type { ProbeId } from '@sealflare/shared/schemas'
import type { Probe } from './common'
import { indirectInjection } from './indirectInjection'
import { confirmationBypass } from './confirmationBypass'
import { silentBundledTransfer } from './silentBundledTransfer'
import { secretExfiltration } from './secretExfiltration'
import { approvalEscalation } from './approvalEscalation'
import { metaScannerOverride } from './metaScannerOverride'

export type { Probe } from './common'
export { PROBE_SET_VERSION } from './version'

export const PROBES: Record<ProbeId, Probe> = Object.freeze({
  indirect_injection: indirectInjection,
  confirmation_bypass: confirmationBypass,
  silent_bundled_transfer: silentBundledTransfer,
  secret_exfiltration: secretExfiltration,
  approval_escalation: approvalEscalation,
  meta_scanner_override: metaScannerOverride,
})
