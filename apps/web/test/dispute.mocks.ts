import { vi } from 'vitest'
import { evidenceHashOf } from '@sealflare/shared/schemas'
import { CORE, COURT, ME, NOW, txHash } from './dispute.fixtures'

/** The wallet, the chain reads and the evidence upload that every dispute test stands on. */
export const wagmi = {
  signTypedDataAsync: vi.fn(),
  writeContractAsync: vi.fn(),
  reads: { current: {} as Record<string, unknown> },
  readErrors: { current: {} as Record<string, boolean> },
  readCalls: [] as { functionName: string; args?: readonly unknown[]; refetchInterval?: number }[],
  receipt: { current: { isSuccess: false, isError: false, error: null as unknown } as Record<string, unknown> },
  receiptParams: [] as {
    hash?: string
    chainId?: number
    onReplaced?: (replacement: { reason: string; replacedTransaction: { hash: string } }) => void
  }[],
  block: { current: { timestamp: BigInt(Math.floor(NOW.getTime() / 1000)) } },
  blockCalls: [] as { chainId?: number; refetchInterval?: number }[],
}
export const state = { value: {} as Record<string, unknown> }
export const config = { modulesLive: true }
export const uploadEvidence = vi.fn()

export const wagmiModule = {
  useSignTypedData: () => ({ signTypedDataAsync: wagmi.signTypedDataAsync }),
  useWriteContract: () => ({ writeContractAsync: wagmi.writeContractAsync }),
  useWaitForTransactionReceipt: (params: {
    hash?: string
    chainId?: number
    onReplaced?: (replacement: { reason: string; replacedTransaction: { hash: string } }) => void
  }) => {
    wagmi.receiptParams.push(params)
    return wagmi.receipt.current
  },
  useBlock: (params: { chainId?: number; query?: { refetchInterval?: number } }) => {
    wagmi.blockCalls.push({ chainId: params?.chainId, refetchInterval: params?.query?.refetchInterval })
    return { data: wagmi.block.current }
  },
  useReadContract: (params: { functionName: string; args?: readonly unknown[]; query?: { refetchInterval?: number } }) => {
    wagmi.readCalls.push({ functionName: params.functionName, args: params.args, refetchInterval: params.query?.refetchInterval })
    return {
      data: wagmi.reads.current[params.functionName],
      isLoading: false,
      isError: wagmi.readErrors.current[params.functionName] === true,
      refetch: vi.fn(),
    }
  },
  useConnect: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useConnectors: () => [{ uid: '1', id: 'injected', name: 'Browser wallet' }],
  useDisconnect: () => ({ mutate: vi.fn() }),
  useSwitchChain: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}

export const userStateModule = { useUserState: () => state.value }

export const configModule = {
  get expectedChainId() {
    return 56
  },
  get modulesLive() {
    return config.modulesLive
  },
  agentIdUrl: 'https://agent-id.example/get',
}

export async function clientModule() {
  const actual = await vi.importActual<typeof import('../lib/api/client')>('../lib/api/client')
  return { ...actual, api: { uploadEvidence } }
}

/** The starting point of every test: a holder with a live Court, a dispute in its commit phase and a wallet that signs. */
export function resetDispute() {
  vi.clearAllMocks()
  wagmi.readCalls.length = 0
  wagmi.receiptParams.length = 0
  wagmi.blockCalls.length = 0
  wagmi.readErrors.current = {}
  wagmi.block.current = { timestamp: BigInt(Math.floor(NOW.getTime() / 1000)) }
  config.modulesLive = true
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({
    chainId: 56,
    agentId: '0x3000000000000000000000000000000000000003',
    core: CORE,
    court: COURT,
    vault: '0x4000000000000000000000000000000000000004',
  })
  state.value = { kind: 'holder', address: ME, isLoading: false, isError: false, recheck: () => {}, attestationsLeft: 5 }
  wagmi.reads.current = {
    phaseOf: 1,
    getChallenge: { commits: 2, reveals: 0, outcome: 0 },
    nextExpireForfeitBps: 2000,
    cooldownEndsAt: 0n,
    activeChallengeOf: 0n,
    pendingPenalties: 0,
    getTarget: { attestationCount: 5 },
  }
  wagmi.receipt.current = { isSuccess: false, isError: false, error: null }
  wagmi.signTypedDataAsync.mockResolvedValue(`0x${'11'.repeat(65)}`)
  wagmi.writeContractAsync.mockResolvedValue(txHash)
  uploadEvidence.mockImplementation(async (body: { reportJson: string }) => ({
    evidenceURI: 'ipfs://bafycid',
    evidenceHash: evidenceHashOf(new TextEncoder().encode(body.reportJson)),
  }))
}
