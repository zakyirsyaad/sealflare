'use client'
import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { toFunctionSelector, type Address } from 'viem'
import { expectedChainId } from '../chain/config'
import { isRevertError } from '../chain/errors'
import { findDeployNonce } from './deployNonce'
import { decodeOwner } from './owner'

const OWNER_SELECTOR = toFunctionSelector('owner()')

export type OwnerState = {
  status: 'idle' | 'loading' | 'owner' | 'none' | 'unknown'
  owner: Address | null
}

/**
 * The owner a contract reports. A target that has no owner, or an owner function that reverts, has
 * no owner the registry can trust. A chain that cannot be read is never read as "no owner".
 */
export function useContractOwner(address: Address | null): OwnerState {
  const client = usePublicClient({ chainId: expectedChainId })
  const [state, setState] = useState<OwnerState>({ status: 'idle', owner: null })
  useEffect(() => {
    if (address === null || client === undefined) return
    let cancelled = false
    setState({ status: 'loading', owner: null })
    void (async () => {
      try {
        const code = await client.getCode({ address })
        if (cancelled) return
        if (code === undefined || code === '0x') {
          setState({ status: 'none', owner: null })
          return
        }
        // `call` answers with an object that holds the data, not with the data itself.
        const { data } = await client.call({ to: address, data: OWNER_SELECTOR })
        if (cancelled) return
        const owner = decodeOwner(data)
        setState({ status: owner === null ? 'none' : 'owner', owner })
      } catch (error) {
        if (cancelled) return
        setState({ status: isRevertError(error) ? 'none' : 'unknown', owner: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [address, client])
  return state
}

/** Whether an address holds code. A contract owner can be a Safe, and a Safe signs on-chain. */
export function useHasCode(address: Address | null): boolean | null {
  const client = usePublicClient({ chainId: expectedChainId })
  const [hasCode, setHasCode] = useState<boolean | null>(null)
  useEffect(() => {
    if (address === null || client === undefined) return
    let cancelled = false
    void (async () => {
      try {
        const code = await client.getCode({ address })
        if (!cancelled) setHasCode(code !== undefined && code !== '0x')
      } catch {
        if (!cancelled) setHasCode(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [address, client])
  return hasCode
}

/** Finds the creation nonce that made the deployer the creator of the contract. */
export function useDeployNonceFinder(): (deployer: Address, contract: Address) => Promise<bigint | null> {
  const client = usePublicClient({ chainId: expectedChainId })
  return async (deployer, contract) => {
    if (client === undefined) return null
    const nonce = await client.getTransactionCount({ address: deployer })
    return await findDeployNonce(deployer, contract, Number(nonce))
  }
}
