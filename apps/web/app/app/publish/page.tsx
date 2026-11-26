'use client'
import { useState, type ReactNode } from 'react'
import { targetIdOfContract } from '@sealflare/shared/rules'
import type { Address, Hex } from 'viem'
import { BadgeSnippet } from '../../../components/publish/BadgeSnippet'
import { BondStep } from '../../../components/publish/BondStep'
import { ContractStep } from '../../../components/publish/ContractStep'
import { KindStep, type PublishKind } from '../../../components/publish/KindStep'
import { OwnerProofStep } from '../../../components/publish/OwnerProofStep'
import { SkillStep } from '../../../components/publish/SkillStep'
import { NoAgentId } from '../../../components/wallet/NoAgentId'
import { WrongNetwork } from '../../../components/wallet/WrongNetwork'
import { addresses } from '../../../lib/chain/addresses'
import { agentIdUrl, expectedChainId } from '../../../lib/chain/config'
import { useUserState } from '../../../lib/chain/userState'
import { copy } from '../../../lib/copy'
import type { BindRequest } from '../../../lib/publish/request'

type Stage = 'target' | 'proof' | 'bond' | 'badge'

type StepProps = {
  number: number
  title: string
  state: 'done' | 'now' | 'next'
  children?: ReactNode
}

/** One step of the flow. A step that is not the current one is only a heading. */
function Step({ number, title, state, children }: StepProps) {
  return (
    <div className={`sf-step sf-step--${state}`}>
      <span className="sf-step__n" aria-hidden="true">
        {number}
      </span>
      <div className="sf-step__body">
        <h2 className="sf-step__title">{title}</h2>
        {state !== 'next' && children}
      </div>
    </div>
  )
}

function coreAddress(): Address | null {
  try {
    return addresses(expectedChainId).core
  } catch {
    return null
  }
}

type TargetStepProps = {
  kind: PublishKind
  core: Address | null
  holder: Address
  connected: Address | null
  onRequest: (request: BindRequest) => void
  onSponsor: (targetId: Hex) => void
  onBound: (targetId: Hex) => void
}

/** The first step: the contract or the skill that is bound. */
function TargetStep({ kind, core, holder, connected, onRequest, onSponsor, onBound }: TargetStepProps) {
  if (kind === 'skill') return <SkillStep connected={connected} onBound={onBound} />
  if (core === null) return null
  return (
    <ContractStep
      core={core}
      agentIdHolder={holder}
      connected={connected}
      onRequest={onRequest}
      onSponsor={onSponsor}
    />
  )
}

type ProofStepProps = {
  request: BindRequest | null
  connected: Address | null
  onBound: (targetId: Hex) => void
}

/** The second step: the proof of ownership, and the binding that follows it. */
function ProofStep({ request, connected, onBound }: ProofStepProps) {
  if (request === null) return null
  return <OwnerProofStep request={request} connected={connected} onBound={() => onBound(targetIdOfContract(request.target))} />
}

/**
 * The Publish screen. It asks what is being bound, proves it, and then offers the optional bond
 * and the badge. Every write comes from the wallet of the visitor: the server signs nothing.
 */
export default function PublishPage() {
  const user = useUserState()
  const [kind, setKind] = useState<PublishKind>('contract')
  const [stage, setStage] = useState<Stage>('target')
  const [request, setRequest] = useState<BindRequest | null>(null)
  const [targetId, setTargetId] = useState<Hex | null>(null)
  const core = coreAddress()
  const connected = user.kind === 'holder' ? user.address : null

  if (user.kind === 'no-wallet') {
    return (
      <section className="sf-container sf-stack">
        <h1 className="sf-step__title">{copy.wallet.connectTitle}</h1>
        <p className="sf-lead">{copy.wallet.connectIntro}</p>
      </section>
    )
  }
  if (user.kind === 'wrong-network') return <WrongNetwork />
  if (user.kind === 'no-agent-id') {
    return (
      <section className="sf-container">
        <NoAgentId recheck={user.recheck} onOtherWallet={user.recheck} agentIdUrl={agentIdUrl} />
      </section>
    )
  }
  if (user.kind === 'checking') {
    return (
      <section className="sf-container sf-stack">
        <p role="status">{copy.wallet.checkingAgentId}</p>
      </section>
    )
  }

  const boundTarget = targetId ?? (request === null ? null : targetIdOfContract(request.target))
  const order: Stage[] = kind === 'contract' ? ['target', 'proof', 'bond', 'badge'] : ['target', 'bond', 'badge']
  const current = order.indexOf(stage)
  const stepState = (index: number): 'done' | 'now' | 'next' =>
    index < current ? 'done' : index === current ? 'now' : 'next'

  return (
    <section className="sf-container sf-publish">
      <div className="sf-stack">
        <h1 className="sf-publish__heading">{copy.publish.heading}</h1>
        <p className="sf-lead">{copy.publish.intro}</p>
        <KindStep
          kind={kind}
          onKind={next => {
            setKind(next)
            setStage('target')
            setRequest(null)
            setTargetId(null)
          }}
        />
      </div>
      <div className="sf-publish__steps">
        <Step
          number={1}
          title={kind === 'contract' ? copy.publish.stepContract : copy.publish.stepSkill}
          state={stepState(0)}
        >
          <TargetStep
            kind={kind}
            core={core}
            holder={user.address}
            connected={connected}
            onRequest={next => {
              setRequest(next)
              setStage('proof')
            }}
            onSponsor={id => {
              setTargetId(id)
              setStage('bond')
            }}
            onBound={id => {
              setTargetId(id)
              setStage('bond')
            }}
          />
        </Step>
        {kind === 'contract' && (
          <Step number={2} title={copy.publish.stepProof} state={stepState(1)}>
            <ProofStep
              request={request}
              connected={connected}
              onBound={id => {
                setTargetId(id)
                setStage('bond')
              }}
            />
          </Step>
        )}
        <Step number={kind === 'contract' ? 3 : 2} title={copy.publish.stepBond} state={stepState(kind === 'contract' ? 2 : 1)}>
          {boundTarget === null ? null : (
            <BondStep
              targetId={boundTarget}
              connected={connected}
              onDone={() => {
                setStage('badge')
              }}
            />
          )}
        </Step>
        <Step number={kind === 'contract' ? 4 : 3} title={copy.publish.stepBadge} state={stepState(kind === 'contract' ? 3 : 2)}>
          {boundTarget === null ? null : <BadgeSnippet targetId={boundTarget} />}
        </Step>
      </div>
    </section>
  )
}
