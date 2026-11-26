'use client'
import { useCallback, useEffect, useState } from 'react'
import type { SandboxResult } from '@sealflare/shared/schemas'
import { api, type Quota } from '../../lib/api/client'
import { useUserState, type UserState } from '../../lib/chain/userState'
import { copy } from '../../lib/copy'
import { useSandboxRun } from '../../lib/sandbox/useSandboxRun'
import { SandboxView } from './SandboxView'

export type SandboxSectionProps = {
  targetType: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  /** The pinned source of the skill, or null when it is not known. */
  src: string | null
  /** The canonical hash of the bundle, or null when the bundle is not known. */
  bundleHash: string | null
  /** The result the target page already carries, when there is one. */
  sandbox: SandboxResult | null
}

/**
 * Why the button is closed, in one sentence.
 *
 * The button needs a wallet on the right network and an Agent ID, like the attest button. It also
 * needs a bundle: a skill that was never scanned has no hash to sign.
 */
export function blockedReason(
  kind: UserState['kind'],
  bundleHash: string | null,
  src: string | null,
  quota: Quota | null,
): string | null {
  if (kind === 'no-wallet') return copy.sandbox.walletRequired
  if (kind === 'wrong-network') return copy.sandbox.networkRequired
  if (kind === 'no-agent-id') return copy.wallet.agentRequired
  if (kind === 'checking') return copy.wallet.checkingAgentId
  if (bundleHash === null || src === null) return copy.sandbox.notScanned
  if (quota !== null && quota.left === 0) {
    return copy.sandbox.quotaExhausted.replace('{limit}', String(quota.limit))
  }
  return null
}

/**
 * The sandbox of a skill.
 *
 * The result of a run that is already known is shown with the findings. A skill that was never run
 * offers the button, the cost of one run and the runs that are left today. The button asks for a
 * message signature, never for a transaction.
 */
export function SandboxSection({ targetType, src, bundleHash, sandbox }: SandboxSectionProps) {
  const user = useUserState()
  const { run, busy, error, paused, start } = useSandboxRun()
  const [quota, setQuota] = useState<Quota | null>(null)
  const address = user.kind === 'holder' ? user.address : null

  useEffect(() => {
    if (address === null) return
    let alive = true
    void api
      .sandboxQuota(address)
      .then(value => {
        if (alive) setQuota(value)
      })
      .catch(() => {
        // A quota that cannot be read leaves the button open. The service refuses a run that is
        // over the limit, so no run is lost by not knowing the number here.
        if (alive) setQuota(null)
      })
    return () => {
      alive = false
    }
  }, [address])

  const reason = blockedReason(user.kind, bundleHash, src, quota)

  const onRun = useCallback(() => {
    if (address === null || bundleHash === null || src === null) return
    void start({ bundleHash: bundleHash as `0x${string}`, src, address })
  }, [address, bundleHash, src, start])

  return (
    <SandboxView
      targetType={targetType}
      cached={sandbox}
      run={run}
      paused={paused}
      error={error}
      quota={quota}
      blocked={reason}
      busy={busy || user.isLoading}
      onRun={onRun}
    />
  )
}
