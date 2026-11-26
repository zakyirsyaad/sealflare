'use client'
import { useMemo, useState } from 'react'
import { useReadContract } from 'wagmi'
import { zeroAddress, type Address, type Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { AddressSchema } from '@sealflare/shared/schemas'
import { targetIdOfContract } from '@sealflare/shared/rules'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { expectedChainId } from '../../lib/chain/config'
import { shortAddress } from '../../lib/format'
import { publisherRoleOf } from '../../lib/publish/binding'
import { REQUEST_VALIDITY_SECONDS, type BindRequest } from '../../lib/publish/request'
import { useBind } from '../../lib/publish/useBind'
import { useContractOwner, useDeployNonceFinder } from '../../lib/publish/useChainReads'

const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex

export type ContractStepProps = {
  core: Address
  agentIdHolder: Address
  connected: Address | null
  onRequest: (request: BindRequest) => void
  onSponsor: (targetId: Hex) => void
}

type OwnerBranchProps = {
  owner: Address
  connected: Address | null
  request: BindRequest | null
  onRequest: (request: BindRequest) => void
}

/** The contract has an owner. That owner, or the connected wallet, proves the ownership. */
function OwnerBranch({ owner, connected, request, onRequest }: OwnerBranchProps) {
  const mine = owner.toLowerCase() === connected?.toLowerCase()
  return (
    <div className="sf-stack">
      <p>
        {mine ? copy.publish.ownerIsYou : copy.publish.ownerIsOther.replace('{owner}', shortAddress(owner))}
      </p>
      <Button variant="primary" disabled={request === null} onClick={() => request !== null && onRequest(request)}>
        {copy.publish.proveOwnership}
      </Button>
    </div>
  )
}

type DeployerBranchProps = {
  deployer: string
  onDeployer: (value: string) => void
  error: string | null
  found: boolean
  request: BindRequest | null
  onSearch: () => void
  onRequest: (request: BindRequest) => void
}

/** The contract has no owner, so the wallet that deployed it signs for it. */
function DeployerBranch({ deployer, onDeployer, error, found, request, onSearch, onRequest }: DeployerBranchProps) {
  return (
    <div className="sf-stack">
      <p>{copy.publish.noOwner}</p>
      <label className="sf-field">
        <span className="sf-field__label">{copy.publish.deployerLabel}</span>
        <input
          className="sf-scan__input mono"
          type="text"
          value={deployer}
          onChange={event => onDeployer(event.target.value)}
          placeholder={copy.publish.addressHint}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <Button disabled={deployer.trim() === ''} onClick={onSearch}>
        {copy.publish.findNonce}
      </Button>
      {error !== null && <p role="alert">{error}</p>}
      {found && (
        <Button variant="primary" disabled={request === null} onClick={() => request !== null && onRequest(request)}>
          {copy.publish.proveOwnership}
        </Button>
      )}
    </div>
  )
}

type SponsorBranchProps = {
  owner: Address | null
  sending: boolean
  error: string | null
  onSponsor: () => void
}

/** The sponsor role, for a wallet that cannot prove the ownership of the target. */
function SponsorBranch({ owner, sending, error, onSponsor }: SponsorBranchProps) {
  return (
    <div className="sf-stack">
      <p>
        {owner === null
          ? copy.publish.sponsorExplain
          : copy.publish.sponsorExplainOther.replace('{owner}', shortAddress(owner))}
      </p>
      <Button disabled={sending} onClick={onSponsor}>
        {copy.publish.becomeSponsor}
      </Button>
      {error !== null && <p role="alert">{error}</p>}
    </div>
  )
}

/**
 * The contract branch of the Publish flow. It reads the owner of the contract and asks for the
 * deployer when the contract has no owner. The binding happens in the step that follows, apart
 * from the sponsor role, which the visitor records right here.
 */
export function ContractStep({ core, agentIdHolder, connected, onRequest, onSponsor }: ContractStepProps) {
  const { state, sponsor } = useBind()
  const [address, setAddress] = useState('')
  const [checked, setChecked] = useState(false)
  const [deadlineAt, setDeadlineAt] = useState(0)
  const [deployer, setDeployer] = useState('')
  const [deployNonce, setDeployNonce] = useState<bigint | null>(null)
  const [deployerError, setDeployerError] = useState<string | null>(null)
  const parsed = useMemo(() => {
    const result = AddressSchema.safeParse(address.trim())
    return result.success ? result.data : null
  }, [address])
  const targetId = parsed === null ? null : targetIdOfContract(parsed)
  const target = useReadContract({
    address: core,
    abi: coreAbi,
    functionName: 'getTarget',
    args: [targetId ?? ZERO_HASH],
    chainId: expectedChainId,
    query: { enabled: targetId !== null },
  })
  const nonce = useReadContract({
    address: core,
    abi: coreAbi,
    functionName: 'bindNonce',
    args: [parsed ?? zeroAddress],
    chainId: expectedChainId,
    query: { enabled: parsed !== null },
  })
  const owner = useContractOwner(parsed)
  const findNonce = useDeployNonceFinder()

  const role = target.data === undefined ? 'NONE' : publisherRoleOf(target.data.publisherRole)
  const bound = role !== 'NONE'
  const exists = (target.data?.createdAt ?? 0) > 0
  // The sponsor role is for a wallet that cannot prove ownership. The owner of the contract, the
  // connected wallet, proves it instead.
  const isOwner =
    owner.status === 'owner' && owner.owner !== null && owner.owner.toLowerCase() === connected?.toLowerCase()
  const offerSponsor = !bound && exists && !isOwner

  const ownerRequest = useMemo<BindRequest | null>(() => {
    if (parsed === null || owner.owner === null || nonce.data === undefined || deadlineAt === 0) return null
    return {
      v: 1,
      kind: 'owner',
      chainId: expectedChainId,
      core,
      target: parsed,
      agentIdHolder,
      bindNonce: nonce.data.toString(),
      deadline: String(deadlineAt),
      owner: owner.owner,
    }
  }, [parsed, owner.owner, nonce.data, deadlineAt, core, agentIdHolder])

  const deployerRequest = useMemo<BindRequest | null>(() => {
    if (parsed === null || deployNonce === null || nonce.data === undefined || deadlineAt === 0) return null
    const deployerAddress = AddressSchema.safeParse(deployer.trim())
    if (!deployerAddress.success) return null
    return {
      v: 1,
      kind: 'deployer',
      chainId: expectedChainId,
      core,
      target: parsed,
      agentIdHolder,
      bindNonce: nonce.data.toString(),
      deadline: String(deadlineAt),
      deployer: deployerAddress.data,
      deployNonce: deployNonce.toString(),
    }
  }, [parsed, deployNonce, nonce.data, deadlineAt, core, agentIdHolder, deployer])

  function check() {
    if (parsed === null) return
    setDeadlineAt(Math.floor(Date.now() / 1000) + REQUEST_VALIDITY_SECONDS)
    setChecked(true)
  }

  async function searchNonce() {
    const deployerAddress = AddressSchema.safeParse(deployer.trim())
    if (!deployerAddress.success || parsed === null) return
    setDeployerError(null)
    const found = await findNonce(deployerAddress.data, parsed)
    if (found === null) {
      setDeployNonce(null)
      setDeployerError(copy.publish.deployerMismatch)
      return
    }
    setDeployNonce(found)
  }

  async function offer(): Promise<void> {
    if (targetId === null) return
    const done = await sponsor(targetId)
    if (done) onSponsor(targetId)
  }

  return (
    <section className="sf-stack" aria-label={copy.publish.kindContract}>
      <label className="sf-field">
        <span className="sf-field__label">{copy.publish.addressLabel}</span>
        <input
          className="sf-scan__input mono"
          type="text"
          value={address}
          onChange={event => setAddress(event.target.value)}
          placeholder={copy.publish.addressHint}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <Button variant="primary" disabled={parsed === null} onClick={check}>
        {copy.publish.checkOwnership}
      </Button>
      {checked && parsed !== null && (
        <p className="sf-mono">
          {shortAddress(parsed)} <span className="sf-chip">{copy.publish.found}</span>
        </p>
      )}
      {checked && bound && <p role="status">{copy.publish.alreadyPublisher}</p>}
      {checked && !bound && owner.status === 'loading' && <p>{copy.publish.checkingOwner}</p>}
      {checked && !bound && owner.status === 'unknown' && <p role="alert">{copy.publish.ownerUnknown}</p>}
      {checked && !bound && owner.status === 'owner' && owner.owner !== null && (
        <OwnerBranch owner={owner.owner} connected={connected} request={ownerRequest} onRequest={onRequest} />
      )}
      {checked && !bound && owner.status === 'none' && (
        <DeployerBranch
          deployer={deployer}
          onDeployer={setDeployer}
          error={deployerError}
          found={deployNonce !== null}
          request={deployerRequest}
          onSearch={() => void searchNonce()}
          onRequest={onRequest}
        />
      )}
      {checked && offerSponsor && (
        <SponsorBranch
          owner={owner.status === 'owner' ? owner.owner : null}
          sending={state.status === 'sending'}
          error={state.error}
          onSponsor={() => void offer()}
        />
      )}
    </section>
  )
}
