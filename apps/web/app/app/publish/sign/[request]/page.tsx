'use client'
import { useEffect, useState } from 'react'
import { useConnection, useReadContract } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { Button } from '../../../../../components/ui/Button'
import { addresses } from '../../../../../lib/chain/addresses'
import { expectedChainId } from '../../../../../lib/chain/config'
import { copy } from '../../../../../lib/copy'
import { formatUtc, shortAddress } from '../../../../../lib/format'
import { decodeRequest, signerOf, type BindRequest } from '../../../../../lib/publish/request'
import { useBind } from '../../../../../lib/publish/useBind'
import { useContractOwner } from '../../../../../lib/publish/useChainReads'

function coreAddress(): string | null {
  try {
    return addresses(expectedChainId).core.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Why the request cannot be signed, in one sentence. Null when it can. A request whose nonce or
 * owner no longer matches the target is stale: signing it would produce a signature that the
 * registry cannot use.
 */
export function refusalReason(
  request: BindRequest | null,
  connected: string | null,
  chainId: number | undefined,
  core: string | null,
  now: number,
  currentNonce: string | null = null,
  currentOwner: string | null = null,
): string | null {
  if (request === null) return copy.publish.requestInvalid
  if (chainId !== expectedChainId || request.chainId !== expectedChainId) return copy.publish.requestWrongChain
  if (core === null || request.core.toLowerCase() !== core) return copy.publish.requestWrongCore
  if (BigInt(request.deadline) * 1000n <= BigInt(now)) return copy.publish.requestExpired
  if (currentNonce !== null && currentNonce !== request.bindNonce) return copy.publish.requestStale
  if (
    currentOwner !== null &&
    request.kind === 'owner' &&
    currentOwner.toLowerCase() !== request.owner.toLowerCase()
  ) {
    return copy.publish.requestStale
  }
  if (connected === null) return copy.wallet.connectTitle
  if (connected.toLowerCase() !== signerOf(request).toLowerCase()) return copy.publish.requestWrongSigner
  return null
}

/**
 * The page the owner opens from the share link. It reads the request out of the fragment of the
 * address bar and never sends it anywhere: the server only serves the shell, and the request
 * never leaves the browser.
 */
export default function SignRequestPage() {
  const connection = useConnection()
  const { state, signRequest } = useBind()
  const [request, setRequest] = useState<BindRequest | null>(null)
  const [read, setRead] = useState(false)
  const [copied, setCopied] = useState(false)
  const core = coreAddress()
  const target = request?.target ?? null
  const nonce = useReadContract({
    address: (core ?? zeroAddress) as Address,
    abi: coreAbi,
    functionName: 'bindNonce',
    args: [target ?? zeroAddress],
    chainId: expectedChainId,
    query: { enabled: target !== null },
  })
  const owner = useContractOwner(request?.kind === 'owner' ? target : null)

  useEffect(() => {
    const fragment = window.location.hash.replace(/^#/, '')
    setRequest(fragment === '' ? null : decodeRequest(fragment))
    setRead(true)
  }, [])

  const connected = connection.address ?? null
  const currentNonce = nonce.data === undefined ? null : nonce.data.toString()
  const currentOwner = owner.status === 'owner' ? owner.owner : null
  const reason = read
    ? refusalReason(request, connected, connection.chainId, core, Date.now(), currentNonce, currentOwner)
    : null
  const checking = nonce.isLoading === true || owner.status === 'loading'

  async function copySignature() {
    if (state.signature === null) return
    try {
      await navigator.clipboard.writeText(state.signature)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="sf-container sf-stack">
      <h1 className="sf-step__title">{copy.publish.requestTitle}</h1>
      <p className="sf-lead">{copy.publish.requestIntro}</p>
      {request !== null && (
        <div className="sf-tab__facts">
          <p>
            {copy.publish.requestTarget}: <span className="sf-mono">{shortAddress(request.target)}</span>
          </p>
          <p>
            {copy.publish.requestHolder}: <span className="sf-mono">{shortAddress(request.agentIdHolder)}</span>
          </p>
          <p>{copy.publish.requestExpiry.replace('{time}', formatUtc(BigInt(request.deadline)))}</p>
        </div>
      )}
      {reason !== null && <p role="alert">{reason}</p>}
      {reason === null && request !== null && (
        <div className="sf-stack">
          {checking && <p role="status">{copy.publish.requestChecking}</p>}
          <Button
            variant="primary"
            disabled={state.status === 'signing' || checking}
            onClick={() => void signRequest(request)}
          >
            {copy.publish.requestSign}
          </Button>
          {state.signature !== null && (
            <>
              <p>{copy.publish.requestSigned}</p>
              <pre className="sf-share__snippet mono">{state.signature}</pre>
              <Button onClick={() => void copySignature()}>
                {copied ? copy.publish.copied : copy.publish.requestCopy}
              </Button>
              <p className="sf-lead">{copy.publish.requestPaste}</p>
            </>
          )}
        </div>
      )}
      {state.error !== null && <p role="alert">{state.error}</p>}
    </section>
  )
}
