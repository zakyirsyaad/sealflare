import type { Address, Hex } from 'viem'
import type { BundleEntry } from '../rules'
import type { ScanReport } from './scan'

/**
 * The seam between scanner-core (Lane 2) and whoever calls it (API, Companion Skill, SDK).
 * scanner-core holds no state and reads no environment: every outside access is injected here.
 */

export interface RpcAdapter {
  getCode(address: Address): Promise<Hex>
  getStorageAt(address: Address, slot: Hex): Promise<Hex>
  call(tx: { to: Address; data: Hex; from?: Address; value?: bigint }): Promise<Hex>
  getBlockNumber(): Promise<bigint>
}

export interface ExplorerAdapter {
  /** null means the explorer did not answer. It never means "not verified". */
  getSource(address: Address): Promise<{ verified: boolean; files: { path: string; content: string }[]; abi?: unknown } | null>
}

/** Select at most one of commit or branch. Neither means the default branch. */
export type RepoRef = { owner: string; repo: string; commit?: string; branch?: string }
export type SkillRef = { owner: string; repo: string; commit: string; path: string }

export interface RepoFetcher {
  /** Resolves the commit and lists every folder that holds a SKILL.md. */
  listSkillFolders(ref: RepoRef): Promise<{ commit: string; folders: string[] }>
  /** Entries of one skill folder at a pinned commit. Symlinks come back as their target text, never followed. */
  fetchBundle(ref: SkillRef): Promise<BundleEntry[]>
}

export interface ScannerCore {
  scanContract(address: Address, deps: { rpc: RpcAdapter; explorer: ExplorerAdapter }): Promise<ScanReport>
  scanSkill(ref: RepoRef & { path?: string }, deps: { repo: RepoFetcher }): Promise<ScanReport>
}

/** One code per row of the scan error table in docs/ux.md 6.6. */
export const SCAN_ERROR_CODES = [
  'INPUT_NOT_RECOGNIZED',
  'NO_CODE_AT_ADDRESS',
  'REPO_NOT_PUBLIC',
  'NO_SKILL_FOUND',
  'MULTIPLE_SKILL_FOLDERS',
  'BUNDLE_TOO_LARGE',
  'RATE_LIMITED',
  'RPC_UNAVAILABLE',
  'RESULT_NOT_CACHED',
] as const
export type ScanErrorCode = (typeof SCAN_ERROR_CODES)[number]

export type ScanErrorDetails = { folders?: string[]; retryAfterSeconds?: number }

export class ScanError extends Error {
  readonly code: ScanErrorCode
  readonly details?: ScanErrorDetails

  constructor(code: ScanErrorCode, message: string, details?: ScanErrorDetails) {
    super(message)
    this.name = 'ScanError'
    this.code = code
    this.details = details
  }
}
