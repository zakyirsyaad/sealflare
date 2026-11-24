import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError,
  encodeFunctionData, type Address } from 'viem'
import { AddressSchema, Bytes32Schema, type Check, type Finding, type RpcAdapter } from '@sealflare/shared/schemas'

type Result = { check: Check; findings: Finding[] }
const transferAbi = [{ type: 'function', name: 'transfer', stateMutability: 'nonpayable',
  inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ type: 'bool' }] }] as const
const plain = (status: Check['status']): Result => ({ check: { id: 'dry_run', status }, findings: [] })

function isRevert(error: unknown): boolean {
  return error instanceof BaseError && error.walk((cause) =>
    cause instanceof ExecutionRevertedError || cause instanceof ContractFunctionRevertedError) !== null
}

function rejected(address: Address): Result {
  return { check: { id: 'dry_run', status: 'flagged' }, findings: [{
    checkId: 'dry_run', flag: 'HONEYPOT_OR_BLACKLIST', title: 'Zero transfer rejected',
    location: address, excerpt: 'A simulated zero-value transfer to the token itself was rejected.',
  }] }
}

async function tokenSupport(address: Address, rpc: RpcAdapter): Promise<Check['status']> {
  const responses = await Promise.allSettled([
    rpc.call({ to: address, data: '0x313ce567' }), rpc.call({ to: address, data: '0x18160ddd' }),
  ])
  if (responses.some((response) => response.status === 'rejected' && !isRevert(response.reason))) return 'failed'
  if (responses.some((response) => response.status === 'rejected')) return 'skipped'
  const words = responses.map((response) => {
    if (response.status !== 'fulfilled') throw Error('Missing token response.')
    return response.value
  })
  if (words.some((word) => word === '0x')) return 'skipped'
  const [decimals] = words.map((word) => BigInt(Bytes32Schema.parse(word)))
  return decimals! <= 255n ? 'passed' : 'failed'
}

/** eth_call only. Infrastructure errors cannot be used as evidence of a honeypot. */
export async function dryRun(address: Address, rpc: RpcAdapter): Promise<Result> {
  try {
    const target = AddressSchema.parse(address)
    const support = await tokenSupport(target, rpc)
    if (support !== 'passed') return plain(support)
    const data = encodeFunctionData({ abi: transferAbi, functionName: 'transfer', args: [target, 0n] })
    try {
      const response = await rpc.call({ to: target, from: target, data })
      if (response === '0x') return plain('passed')
      const result = BigInt(Bytes32Schema.parse(response))
      if (result === 0n) return rejected(target)
      return plain(result === 1n ? 'passed' : 'failed')
    } catch (error) {
      return isRevert(error) ? rejected(target) : plain('failed')
    }
  } catch {
    return plain('failed')
  }
}
