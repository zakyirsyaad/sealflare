import { keccak256, type Address, type Hex } from 'viem'
import { z } from 'zod'
import { FLAGS, targetIdOfContract } from '@sealflare/shared/rules'
import { AddressSchema, Check, Finding, CONTRACT_CHECK_IDS, ScanError, ScanReport,
  type CheckId, type ExplorerAdapter, type RpcAdapter } from '@sealflare/shared/schemas'
import { suggestVerdict } from '../verdict'
import { Bytecode, hasDelegatecall } from './bytecode'
import { findAdminFunctions } from './adminFunctions'
import { dryRun } from './dryRun'
import { inspectProxy, type ProxyInfo } from './proxy'
import { Abi } from './abi'

type Result = { check: Check; findings: Finding[] }
const plain = (id: CheckId, status: Check['status']): Result => ({ check: { id, status }, findings: [] })
const finding = (id: CheckId, flag: Finding['flag'], title: string, location: string, excerpt: string): Result => ({
  check: { id, status: 'flagged' }, findings: [{ checkId: id, flag, title, location, excerpt }],
})
const ExplorerSource = z.object({ verified: z.boolean(),
  files: z.array(z.object({ path: z.string(), content: z.string() })), abi: z.unknown().optional() })

async function guard(id: CheckId, run: () => Promise<Result>): Promise<Result> {
  try {
    const result = await run()
    const check = Check.parse(result.check), findings = z.array(Finding).parse(result.findings)
    if (check.id !== id || findings.some((item) => item.checkId !== id)) throw Error('Mismatched check id.')
    if ((check.status === 'flagged') !== (findings.length > 0)) throw Error('Inconsistent check result.')
    return { check, findings }
  } catch {
    return plain(id, 'failed')
  }
}

async function sourceChecks(address: Address, explorer: ExplorerAdapter): Promise<Result[]> {
  let source: z.infer<typeof ExplorerSource>
  try {
    const response = await explorer.getSource(address)
    if (response === null) throw Error('Explorer unavailable.')
    source = ExplorerSource.parse(response)
  } catch {
    return [plain('source_verified', 'failed'), plain('admin_functions', 'skipped')]
  }
  if (!source.verified) return [finding('source_verified', 'UNVERIFIED_SOURCE', 'Source is unverified', address,
    'The explorer has no verified source for this contract.'), plain('admin_functions', 'skipped')]
  const admin = await guard('admin_functions', async () => {
    if (source.abi == null) return plain('admin_functions', 'skipped')
    Abi.parse(source.abi)
    const findings = findAdminFunctions(source.abi).map(({ name, flag }): Finding => ({
      checkId: 'admin_functions', flag, title: 'Risky admin function', location: `ABI:${name}`, excerpt: name,
    }))
    return { check: { id: 'admin_functions', status: findings.length ? 'flagged' : 'passed' }, findings }
  })
  return [plain('source_verified', 'passed'), admin]
}

async function proxyChecks(address: Address, code: Hex, rpc: RpcAdapter) {
  const ids = ['proxy_eip1967', 'proxy_beacon', 'proxy_eip1167'] as const
  let implementation: ProxyInfo
  try {
    implementation = await inspectProxy(address, code, rpc)
  } catch {
    const delegate = hasDelegatecall(code) ? plain('delegatecall_opcode', 'failed') : plain('delegatecall_opcode', 'passed')
    return { implementation: null, results: [...ids.map((id) => plain(id, 'failed')), delegate] }
  }
  const results = ids.map((id): Result => {
    if (implementation?.standard === 'eip1967' && id === 'proxy_eip1967' ||
      implementation?.standard === 'beacon' && id === 'proxy_beacon') {
      return finding(id, 'UPGRADEABLE_NO_TIMELOCK', 'Upgradeable proxy detected', address,
        'An implementation pointer can be changed. A timelock was not established by this scan.')
    }
    return plain(id, 'passed')
  })
  results.push(hasDelegatecall(code) && !implementation
    ? finding('delegatecall_opcode', 'UNPINNABLE_DELEGATECALL', 'Unknown DELEGATECALL target', address,
      'DELEGATECALL occurs outside a recognised EIP-1967, beacon or EIP-1167 proxy.')
    : plain('delegatecall_opcode', 'passed'))
  return { implementation, results }
}

async function readTarget(address: Address, rpc: RpcAdapter) {
  try {
    const [response, blockNumber] = await Promise.all([rpc.getCode(address), rpc.getBlockNumber()])
    const code = Bytecode.parse(response)
    if (typeof blockNumber !== 'bigint' || blockNumber < 0n) throw Error('Invalid block number.')
    return { code, blockNumber: blockNumber.toString() }
  } catch {
    throw new ScanError('RPC_UNAVAILABLE', 'BNB Chain could not be reached. No verdict was produced.')
  }
}

export async function scanContract(address: Address,
  deps: { rpc: RpcAdapter; explorer: ExplorerAdapter; now?: () => Date },
): Promise<ScanReport> {
  const input = AddressSchema.safeParse(address)
  if (!input.success) throw new ScanError('INPUT_NOT_RECOGNIZED', 'That is not a contract address.')
  const target = input.data, { code, blockNumber } = await readTarget(target, deps.rpc)
  if (code === '0x') throw new ScanError('NO_CODE_AT_ADDRESS', 'No contract is deployed at this address on BNB Chain.')
  const [source, proxy, dry] = await Promise.all([
    sourceChecks(target, deps.explorer), proxyChecks(target, code, deps.rpc), guard('dry_run', () => dryRun(target, deps.rpc)),
  ])
  const results = [...source, ...proxy.results, dry], checks = results.map(({ check }) => check)
  const findings = results.flatMap((result) => result.findings)
  const implementation = proxy.implementation ? { standard: proxy.implementation.standard,
    address: proxy.implementation.implementation, codehash: proxy.implementation.implementationCodehash } : undefined
  return ScanReport.parse({ schemaVersion: 1, targetType: 'SMART_CONTRACT', targetId: targetIdOfContract(target),
    source: { kind: 'contract', address: target, codehash: keccak256(code), blockNumber, implementation },
    scannedAt: (deps.now?.() ?? new Date()).toISOString(), checks, findings,
    flags: findings.reduce((bits, item) => bits | FLAGS[item.flag], 0),
    suggestedVerdict: suggestVerdict(checks, findings, CONTRACT_CHECK_IDS),
  })
}
