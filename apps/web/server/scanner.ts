import 'server-only'
import { createScanner } from '@sealflare/scanner-core'
import { createExplorerAdapter, createGitHubFetcher, createRpcAdapter } from '@sealflare/scanner-core/adapters'
import { targetIdOfContract } from '@sealflare/shared/rules'
import { ScanReport, type ExplorerAdapter, type RepoFetcher, type RpcAdapter, type ScannerCore } from '@sealflare/shared/schemas'
import { parseServerEnv } from '../lib/env.schema'
import contractClean from '@sealflare/shared/fixtures/scans/contract-clean.json'
import skillClean from '@sealflare/shared/fixtures/scans/skill-clean.json'

export type ScanEnvironment = {
  scanner: ScannerCore
  rpc: RpcAdapter
  explorer: ExplorerAdapter
  repo: RepoFetcher
  now: () => Date
}

/**
 * The mock scanner answers from the shared fixtures. Its contract report keeps the fixture's
 * checks and findings but names the address that was asked for, so the target id matches.
 */
function mockScanner(now: () => Date): ScannerCore {
  return {
    scanContract: async address => {
      const report = ScanReport.parse({
        ...contractClean,
        targetId: targetIdOfContract(address),
        source: { ...contractClean.source, address },
        scannedAt: now().toISOString(),
      })
      return report
    },
    scanSkill: async () => ScanReport.parse({ ...skillClean, scannedAt: now().toISOString() }),
  }
}

function mockEnvironment(now: () => Date): ScanEnvironment {
  const refuse = async (): Promise<never> => {
    throw new Error('The mock scanner does not reach outside.')
  }
  return {
    scanner: mockScanner(now),
    rpc: { getCode: refuse, getStorageAt: refuse, call: refuse, getBlockNumber: refuse },
    explorer: { getSource: refuse },
    repo: { listSkillFolders: refuse, fetchBundle: refuse },
    now,
  }
}

function realEnvironment(now: () => Date): ScanEnvironment {
  const env = parseServerEnv(process.env)
  return {
    scanner: createScanner(),
    rpc: createRpcAdapter(env.RPC_URLS),
    explorer: createExplorerAdapter({ apiKey: env.BSCSCAN_KEY }),
    repo: createGitHubFetcher({ token: env.GITHUB_TOKEN }),
    now,
  }
}

let cached: ScanEnvironment | null = null

/**
 * The only place that reads SCANNER. Everything else takes the scanner and its dependencies.
 */
export function getScanEnvironment(): ScanEnvironment {
  if (cached) return cached
  const now = () => new Date()
  const environment = process.env.SCANNER === 'real' ? realEnvironment(now) : mockEnvironment(now)
  cached = environment
  return environment
}
