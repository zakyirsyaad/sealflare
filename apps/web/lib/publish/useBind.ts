'use client'
import { useState } from 'react'
import { usePublicClient, useSignTypedData, useWriteContract } from 'wagmi'
import type { Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { requireCoreAddress } from '../chain/addresses'
import { expectedChainId } from '../chain/config'
import { isUserRejection, translateContractError } from '../chain/errors'
import { copy } from '../copy'
import { confirmWrite, WriteFailed } from './confirm'
import { bindTypedData, type BindRequest, type DeployerBindRequest, type OwnerBindRequest } from './request'
import { isPlainSignature, signatureMatches } from './signature'

export type BindStatus = 'idle' | 'signing' | 'sending' | 'done' | 'failed'

export type BindState = {
  status: BindStatus
  error: string | null
  txHash: Hex | null
  signature: Hex | null
}

/** `onChain`: the signer is a contract wallet, so the registry checks the signature, not the browser. */
export type BindOptions = { onChain?: boolean }

const idle: BindState = { status: 'idle', error: null, txHash: null, signature: null }

/**
 * Every write of the Publish flow. The wallet signs and pays, the server never does, and a
 * rejection in the wallet is not shown as an error.
 */
export function useBind() {
  const sign = useSignTypedData()
  const write = useWriteContract()
  const client = usePublicClient({ chainId: expectedChainId })
  const [state, setState] = useState<BindState>(idle)

  function fail(error: unknown): void {
    if (isUserRejection(error)) {
      setState(idle)
      return
    }
    const translated = translateContractError(error)
    const message = error instanceof WriteFailed ? error.message : (translated?.message ?? copy.errors.unknown)
    setState({ status: 'failed', error: message, txHash: null, signature: null })
  }

  /** The owner or the deployer signs the request. It costs no gas. */
  async function signRequest(request: BindRequest): Promise<Hex | null> {
    setState(current => ({ ...current, status: 'signing', error: null }))
    try {
      const typed = bindTypedData(request)
      const signature = await sign.mutateAsync({
        domain: typed.domain,
        types: typed.types,
        primaryType: typed.primaryType,
        message: typed.message,
      })
      setState(current => ({ ...current, status: 'idle', signature }))
      return signature
    } catch (error) {
      fail(error)
      return null
    }
  }

  /**
   * A signature that came from outside is checked here as well: a signature made by another
   * wallet never reaches the chain. A signature of a contract wallet cannot be read without the
   * chain, and the registry checks it there.
   */
  async function accepts(request: BindRequest, signature: Hex): Promise<boolean> {
    if (!isPlainSignature(signature)) return true
    const matches = await signatureMatches(request, signature)
    if (!matches) {
      setState({ status: 'failed', error: copy.publish.signatureWrongSigner, txHash: null, signature: null })
      return false
    }
    return true
  }

  /**
   * The signature of the request. A signature that was pasted in is checked, and a signature that
   * the wallet of the visitor just made is the wallet's own and is not read again. A signature of a
   * contract wallet is left to the registry, because it cannot be read without the chain.
   */
  async function signatureFor(request: BindRequest, pasted: Hex | undefined, onChain: boolean): Promise<Hex | null> {
    if (pasted === undefined) return await signRequest(request)
    if (!onChain && !(await accepts(request, pasted))) return null
    return pasted
  }

  async function bindByOwner(request: OwnerBindRequest, signature?: Hex, options: BindOptions = {}): Promise<void> {
    const signed = await signatureFor(request, signature, options.onChain === true)
    if (signed === undefined || signed === null) return
    setState(current => ({ ...current, status: 'sending', error: null, signature: signed }))
    try {
      const txHash = await write.mutateAsync({
        address: requireCoreAddress(),
        abi: coreAbi,
        functionName: 'bindByOwner',
        args: [request.target, request.agentIdHolder, BigInt(request.deadline), signed],
        chainId: expectedChainId,
      })
      await confirmWrite(client, txHash)
      setState({ status: 'done', error: null, txHash, signature: signed })
    } catch (error) {
      fail(error)
    }
  }

  async function bindByDeployer(
    request: DeployerBindRequest,
    signature?: Hex,
    options: BindOptions = {},
  ): Promise<void> {
    const signed = await signatureFor(request, signature, options.onChain === true)
    if (signed === undefined || signed === null) return
    setState(current => ({ ...current, status: 'sending', error: null, signature: signed }))
    try {
      const txHash = await write.mutateAsync({
        address: requireCoreAddress(),
        abi: coreAbi,
        functionName: 'bindByDeployer',
        args: [
          request.target,
          request.deployer,
          BigInt(request.deployNonce),
          request.agentIdHolder,
          BigInt(request.deadline),
          signed,
        ],
        chainId: expectedChainId,
      })
      await confirmWrite(client, txHash)
      setState({ status: 'done', error: null, txHash, signature: signed })
    } catch (error) {
      fail(error)
    }
  }

  async function bindSkill(contentHash: Hex): Promise<boolean> {
    setState(current => ({ ...current, status: 'sending', error: null }))
    try {
      const txHash = await write.mutateAsync({
        address: requireCoreAddress(),
        abi: coreAbi,
        functionName: 'bindSkill',
        args: [contentHash],
        chainId: expectedChainId,
      })
      await confirmWrite(client, txHash)
      setState({ status: 'done', error: null, txHash, signature: null })
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }

  async function sponsor(targetId: Hex): Promise<boolean> {
    setState(current => ({ ...current, status: 'sending', error: null }))
    try {
      const txHash = await write.mutateAsync({
        address: requireCoreAddress(),
        abi: coreAbi,
        functionName: 'sponsor',
        args: [targetId],
        chainId: expectedChainId,
      })
      await confirmWrite(client, txHash)
      setState({ status: 'done', error: null, txHash, signature: null })
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }

  return { state, signRequest, bindByOwner, bindByDeployer, bindSkill, sponsor, reset: () => setState(idle) }
}
