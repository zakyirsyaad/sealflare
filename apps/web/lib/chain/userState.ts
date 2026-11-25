'use client'
import { useConnection, useReadContract } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { addresses } from './addresses'
import { expectedChainId } from './config'

export type UserState =
  | { kind: 'no-wallet' }
  | { kind: 'wrong-network' }
  | { kind: 'checking'; address: Address }
  | { kind: 'no-agent-id'; address: Address }
  | { kind: 'holder'; address: Address; attestationsLeft: number | null }

export type UserStateInput = {
  isConnected: boolean
  address?: Address
  chainId?: number
  expectedChainId: number
  isHolder?: boolean
  attestationsLeft?: number
}

export function resolveUserState(input: UserStateInput): UserState {
  const { address } = input
  if (!input.isConnected || !address) return { kind: 'no-wallet' }
  if (input.chainId !== input.expectedChainId) return { kind: 'wrong-network' }
  if (input.isHolder === undefined) return { kind: 'checking', address }
  if (!input.isHolder) return { kind: 'no-agent-id', address }
  return { kind: 'holder', address, attestationsLeft: input.attestationsLeft ?? null }
}

function coreAddress(): { core?: Address; error?: string } {
  try {
    return { core: addresses(expectedChainId).core }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export type UserStateResult = UserState & { isLoading: boolean; isError: boolean; error?: string; recheck: () => void }

export function useUserState(): UserStateResult {
  const connection = useConnection()
  const connected = connection.isConnected && connection.address !== undefined && connection.chainId === expectedChainId
  const { core, error: configError } = connected ? coreAddress() : {}
  const ready = connected && core !== undefined
  const args = [connection.address ?? zeroAddress] as const
  const read = { abi: coreAbi, address: core, chainId: expectedChainId, args, query: { enabled: ready } } as const
  const holder = useReadContract({ ...read, functionName: 'isAgentIdHolder' })
  const quota = useReadContract({ ...read, functionName: 'attestationsLeftToday' })
  const state = resolveUserState({
    isConnected: connection.isConnected,
    address: connection.address,
    chainId: connection.chainId,
    expectedChainId,
    isHolder: ready ? holder.data : undefined,
    attestationsLeft: ready ? quota.data : undefined,
  })
  return {
    ...state,
    isLoading: connection.isReconnecting === true || (ready && Boolean(holder.isLoading || quota.isLoading)),
    isError: configError !== undefined || (ready && Boolean(holder.isError || quota.isError)),
    ...(configError !== undefined ? { error: configError } : {}),
    recheck: () => { void holder.refetch(); void quota.refetch() },
  }
}
