import { useRef, useState } from 'react'
import { vi } from 'vitest'
import { ACCOUNT, chain } from './activity.fixtures'

/**
 * The chain, as the screen reads it.
 *
 * A batch of reads answers with one entry per call, and every entry says whether the call
 * succeeded, the same way the chain answers a reader that asks for many things at once. A single
 * read answers with the value itself.
 */
export const useReadContract = (config: {
  functionName: string
  address?: string
  query?: { enabled?: boolean }
}) => {
  const [, bump] = useState(0)
  // A read without a contract has no answer, the same as a read that is not enabled.
  const silent =
    chain.readsFailed ||
    config.address === undefined ||
    config.query?.enabled === false ||
    chain.pending.includes(config.functionName)
  const data = silent ? undefined : (chain as unknown as Record<string, unknown>)[config.functionName]
  const refetch = () => {
    chain.refetches[config.functionName] = (chain.refetches[config.functionName] ?? 0) + 1
    bump(value => value + 1)
  }
  return { data, refetch, isLoading: false, isError: chain.readsFailed }
}

/** The batch of the reads, with one entry per call. */
export const useReadContracts = (config: {
  contracts: { functionName: string; args: readonly unknown[] }[]
}) => {
  const [version, bump] = useState(0)
  const store = useRef<{ signature: string; data: unknown } | null>(null)
  const signature = config.contracts
    .map(contract => `${contract.functionName}:${String(contract.args[0])}:${String(contract.args[1] ?? '')}`)
    .join('|')
  const compute = () =>
    config.contracts.map(contract => {
      const name = contract.functionName
      if (name === 'pendingPenalties') {
        return { status: 'success', result: chain.penalties[String(contract.args[0])] ?? 0 }
      }
      if (name === 'getTarget') {
        if (chain.targetsFailed) return { status: 'failure', result: undefined }
        return { status: 'success', result: chain.targets[String(contract.args[0])] ?? null }
      }
      if (name === 'getAttestation') {
        // The window of attestations cannot be read, as if the chain could not answer.
        if (chain.rangeFailed) return { status: 'failure', result: undefined }
        const attestation = chain.attestations[Number(contract.args[1])] ?? { verdict: 0, penalized: false }
        return { status: 'success', result: attestation }
      }
      return { status: 'success', result: undefined }
    })
  if (store.current === null || store.current.signature !== signature) {
    store.current = { signature, data: compute() }
  }
  // The answer of the chain arrives after the call. A held answer waits for the test.
  const refetch = () => {
    const next = compute()
    const sig = signature
    const deliver = () => {
      store.current = { signature: sig, data: next }
      bump(value => value + 1)
    }
    const isRange = config.contracts.some(contract => contract.functionName === 'getAttestation')
    if (chain.holdReads || (chain.holdRange && isRange)) {
      return new Promise(resolve => {
        chain.releases.push(() => {
          deliver()
          resolve({ data: next })
        })
      })
    }
    deliver()
    return Promise.resolve({ data: next })
  }
  return {
    data: chain.readsFailed ? undefined : store.current.data,
    dataUpdatedAt: version,
    refetch,
    isLoading: false,
    isError: chain.readsFailed,
  }
}

/** The time of the chain, as the latest block says it. */
export const useBlock = () => ({ data: { timestamp: BigInt(Math.floor(Date.now() / 1000)) } })

/** The wallet of the reader. */
export const useWriteContract = () => ({
  // The contract charges every safe vote of the range, so a page marks the attestations it
  // covered as charged.
  writeContractAsync: async (config: { functionName: string; args: readonly unknown[] }) => {
    const hash = await chain.write(config)
    if (config.functionName === 'applyPenalties') {
      const [, start, count] = config.args
      for (let index = Number(start); index < Number(start) + Number(count); index += 1) {
        chain.attestations[index] = { verdict: 0, penalized: true }
      }
    }
    return hash
  },
})

export const useWaitForTransactionReceipt = () => chain.receipt
export const useConnection = () => ({ isConnected: true, address: ACCOUNT, chainId: 56, isReconnecting: false })
export const useDisconnect = () => ({ mutate: vi.fn() })
export const useSwitchChain = () => ({ mutate: vi.fn(), isPending: false, error: null })
export const useConnect = () => ({ mutate: vi.fn(), isPending: false, error: null })
export const useConnectors = () => [{ uid: '1', id: 'injected', name: 'Browser wallet' }]
