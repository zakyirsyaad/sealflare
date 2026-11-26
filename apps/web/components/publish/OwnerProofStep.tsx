'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { formatUtc } from '../../lib/format'
import { encodeRequest, requestId, signerOf, type BindRequest } from '../../lib/publish/request'
import { isHexSignature, isPlainSignature, signerOfSignature } from '../../lib/publish/signature'
import { useBind } from '../../lib/publish/useBind'
import { useHasCode } from '../../lib/publish/useChainReads'

export type OwnerProofStepProps = {
  request: BindRequest
  connected: Address | null
  onBound: () => void
}

type Check = { signature: Hex | null; error: string | null; note: string | null }

const emptyCheck: Check = { signature: null, error: null, note: null }

/**
 * Checks a pasted signature against the request, in the browser. Nothing is sent anywhere: the
 * wallet that has to sign is named in the request, so the signature is read before a transaction
 * is offered.
 *
 * A signature that is not an ordinary wallet signature comes from a contract wallet, and it is
 * only accepted when the wallet that has to sign really is a contract: the registry checks that
 * signature on-chain.
 */
export async function checkSignature(request: BindRequest, raw: string, signerHasCode: boolean): Promise<Check> {
  const trimmed = raw.trim()
  if (trimmed === '') return emptyCheck
  if (!isHexSignature(trimmed)) return { signature: null, error: copy.publish.signatureInvalid, note: null }
  if (!isPlainSignature(trimmed as Hex)) {
    if (!signerHasCode) return { signature: null, error: copy.publish.signatureInvalid, note: null }
    return { signature: trimmed as Hex, error: null, note: copy.publish.signatureOnChain }
  }
  const signer = await signerOfSignature(request, trimmed as Hex)
  if (signer === null) return { signature: null, error: copy.publish.signatureInvalid, note: null }
  if (signer.toLowerCase() !== signerOf(request).toLowerCase()) {
    return { signature: null, error: copy.publish.signatureWrongSigner, note: null }
  }
  return { signature: trimmed as Hex, error: null, note: null }
}

type ShareBlockProps = {
  link: string
  expiry: string
  copied: boolean
  onCopy: () => void
  raw: string
  onRaw: (value: string) => void
  check: Check
  canBind: boolean
  onBind: () => void
}

/**
 * The share block. The link carries the request in its fragment, so the server never receives it,
 * and the signature that comes back is checked in the browser.
 */
function ShareBlock({ link, expiry, copied, onCopy, raw, onRaw, check, canBind, onBind }: ShareBlockProps) {
  return (
    <>
      <p className="sf-lead">{copy.publish.share}</p>
      <div className="sf-share">
        <div className="sf-share__head">
          <span className="sf-chip">{copy.publish.shareWith}</span>
          <span className="sf-chip">{copy.publish.shareValid}</span>
        </div>
        <div className="sf-share__body">
          <span className="sf-mono sf-share__link">{link}</span>
          <Button onClick={onCopy}>{copied ? copy.publish.copied : copy.publish.copyLink}</Button>
        </div>
      </div>
      <p className="sf-lead">{expiry}</p>
      <label className="sf-field">
        <span className="sf-field__label">{copy.publish.pasteSignatureLabel}</span>
        <input
          className="sf-scan__input mono"
          type="text"
          value={raw}
          onChange={event => onRaw(event.target.value)}
          placeholder="0x..."
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {check.error !== null && <p role="alert">{check.error}</p>}
      {check.note !== null && <p className="sf-lead">{check.note}</p>}
      <Button variant="primary" disabled={!canBind} onClick={onBind}>
        {copy.publish.bindAsPublisher}
      </Button>
      <p className="sf-lead">{copy.publish.safeNote}</p>
    </>
  )
}

/**
 * The proof of ownership. The owner signs once, with no gas, and the Agent ID holder then makes
 * one transaction. When the owner is another wallet, the request travels in the fragment of the
 * share link, so the server never receives it.
 */
export function OwnerProofStep({ request, connected, onBound }: OwnerProofStepProps) {
  const { state, bindByOwner, bindByDeployer } = useBind()
  const [raw, setRaw] = useState('')
  const [copied, setCopied] = useState(false)
  const bound = useRef(false)
  const payload = useMemo(() => encodeRequest(request), [request])
  const id = useMemo(() => requestId(), [request])
  const path = `/app/publish/sign/${id}#${payload}`
  const link = typeof window === 'undefined' ? path : `${window.location.origin}${path}`
  const signer = signerOf(request)
  const sameWallet = connected !== null && connected.toLowerCase() === signer.toLowerCase()
  const signerHasCode = useHasCode(signer)
  const [checked, setChecked] = useState<{ raw: string; result: Check }>({ raw: '', result: emptyCheck })

  // The step that follows opens once the binding is on chain. The bound flag keeps a later
  // render of this step from opening it a second time.
  useEffect(() => {
    if (state.status !== 'done' || bound.current) return
    bound.current = true
    onBound()
  }, [state.status, onBound])

  // The pasted signature is checked in the browser, so the result belongs to the exact text that
  // was pasted. A different text never keeps the result of the previous one.
  useEffect(() => {
    let alive = true
    void checkSignature(request, raw, signerHasCode === true).then(result => {
      if (alive) setChecked({ raw, result })
    })
    return () => {
      alive = false
    }
  }, [request, raw, signerHasCode])

  const check = checked.raw === raw ? checked.result : emptyCheck

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  function bind(signature: Hex | undefined) {
    if (request.kind === 'owner') void bindByOwner(request, signature)
    else void bindByDeployer(request, signature)
  }

  return (
    <section className="sf-stack" aria-label={copy.publish.stepProof}>
      {sameWallet ? (
        <div className="sf-stack">
          <p>{request.kind === 'deployer' ? copy.publish.deployerIsYou : copy.publish.ownerIsYou}</p>
          <Button variant="primary" disabled={state.status === 'sending'} onClick={() => bind(undefined)}>
            {copy.publish.signAndBind}
          </Button>
        </div>
      ) : (
        <ShareBlock
          link={link}
          expiry={copy.publish.requestExpiry.replace('{time}', formatUtc(BigInt(request.deadline)))}
          copied={copied}
          onCopy={() => void copyLink()}
          raw={raw}
          onRaw={setRaw}
          check={check}
          canBind={check.signature !== null}
          onBind={() => bind(check.signature ?? undefined)}
        />
      )}
      {state.error !== null && <p role="alert">{state.error}</p>}
    </section>
  )
}
