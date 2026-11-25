import { describe, expect, test } from 'vitest'
import { createPublicClient, custom, decodeFunctionData, encodeFunctionResult, type Hex } from 'viem'
import { bsc } from 'viem/chains'
import { coreAbi, firewallAbi } from '@sealflare/shared/abi'
import { TRUST_TIERS } from '@sealflare/shared/rules'
import { createGuard } from '../src/index'
import { CORE, TARGET, ZERO_ADDRESS, ZERO_WORD } from './support'

const abi = [...coreAbi, ...firewallAbi]

type Node = { tier: number; code: Hex; callData?: Hex }

/**
 * A real viem client over a node that answers like a real BSC node does for an account without
 * code: `eth_getCode` and `eth_call` both answer `0x`, which viem reads as `undefined`.
 */
function realClient(node: Node) {
  return createPublicClient({
    chain: bsc,
    transport: custom({
      async request({ method, params }) {
        if (method === 'eth_getCode') return node.code
        if (method === 'eth_getStorageAt') return ZERO_WORD
        if (method === 'eth_blockNumber') return '0x10'
        if (method === 'eth_chainId') return '0x38'
        if (method === 'eth_call') {
          const { to, data } = (params as [{ to: string; data: Hex }])[0]
          if (to.toLowerCase() !== CORE.toLowerCase()) return node.callData ?? '0x'
          const decoded = decodeFunctionData({ abi, data })
          const result = answer(decoded.functionName, node)
          return encodeFunctionResult({ abi, functionName: decoded.functionName, result } as never)
        }
        throw new Error(`Unexpected request: ${method}`)
      },
    }),
  })
}

function answer(functionName: string, node: Node): unknown {
  if (functionName === 'tierOf') return node.tier
  if (functionName === 'verifyContract') return [node.tier, false, ZERO_WORD, 0, 0n]
  if (functionName === 'getTarget') {
    return {
      targetType: 0,
      target: ZERO_WORD,
      pinnedCodehash: ZERO_WORD,
      hasDelegatecall: false,
      publisher: ZERO_ADDRESS,
      publisherRole: 0,
      safeWeight: 0,
      cautionWeight: 0,
      dangerWeight: 0,
      activeFlags: 0,
      attestationCount: 0,
      safeCount: 0,
      confirmedDanger: false,
      activeChallengeId: 0n,
      createdAt: 0n,
    }
  }
  throw new Error(`Unexpected read: ${functionName}`)
}

describe('checkContract with a real viem client', () => {
  test('an address without code is UNRATED and not safe, not a ZodError', async () => {
    const guard = createGuard({ client: realClient({ tier: 0, code: '0x' }), core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.tier).toBe('UNRATED')
    expect(verdict.safe).toBe(false)
    expect(verdict.isUpgradeableProxy).toBe(false)
  })

  test('a registered contract whose code is gone reports the drift tier, not a rejection', async () => {
    const tier = TRUST_TIERS.indexOf('STALE_CODEHASH_DRIFT')
    const guard = createGuard({ client: realClient({ tier, code: '0x' }), core: CORE })

    const verdict = await guard.checkContract(TARGET)

    expect(verdict.tier).toBe('STALE_CODEHASH_DRIFT')
    expect(verdict.safe).toBe(false)
  })
})
