import type { Hono } from 'hono'
import type { Address, Hex } from 'viem'
import { bundleIdentity, type BundleEntry } from '@sealflare/shared/rules'
import type { RepoFetcher, SandboxResult, SkillRef, WorkerRunRequest, WorkerRunStatus } from '@sealflare/shared/schemas'
import { PROBE_IDS } from '@sealflare/shared/schemas'
import type { Db } from '../src/db'
import type { ChainReader } from '../src/sandbox/chain'
import { WorkerRefused, WorkerUnavailable, type WorkerClient } from '../src/sandbox/workerClient'
import { testApp } from './helpers'

/** The address the tests sign with. It holds an Agent ID in the fake chain. */
export const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'

/** Another address, one without an Agent ID in the fake chain. */
export const OTHER_ADDRESS = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'

/** The moment every test starts at. */
export const NOW = new Date('2026-11-26T10:00:00.000Z')
export const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)

/** A signature of the right shape. The fake chain does not read it. */
export const SIGNATURE = `0x${'11'.repeat(65)}` as Hex

/** The skill the fake repository holds. */
export const SKILL_TEXT = '# Skill\n\nA skill that helps with something.\n'

/** The source of the skill, as a client names it. */
export const SRC = `gh:sealflare/demo@${'a'.repeat(40)}:skills/demo`

/** A result of a run that caught a forbidden tool call. */
export function failedResult(
  bundleHash: Hex,
  options: { probeSetVersion?: string; modelId?: string } = {},
): SandboxResult {
  return {
    schemaVersion: 1,
    bundleHash,
    probeSetVersion: options.probeSetVersion ?? 'v1',
    modelId: options.modelId ?? 'model-1',
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    status: 'SANDBOX_FUZZ_FAILED',
    probes: [
      {
        probeId: 'indirect_injection',
        runs: [
          { index: 0, outcome: 'violation', violations: [{ tool: 'transfer', args: { to: '0x0' }, rule: 'no-transfer' }] },
        ],
      },
    ],
  }
}

/** A result of a run where every probe finished cleanly. */
export function cleanResult(
  bundleHash: Hex,
  options: { probeSetVersion?: string; modelId?: string } = {},
): SandboxResult {
  return {
    schemaVersion: 1,
    bundleHash,
    probeSetVersion: options.probeSetVersion ?? 'v1',
    modelId: options.modelId ?? 'model-1',
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    status: 'NO_VIOLATION_OBSERVED',
    probes: PROBE_IDS.map(probeId => ({
      probeId,
      runs: ([0, 1, 2] as const).map(index => ({ index, outcome: 'clean' as const, violations: [] })),
    })),
  }
}

/** The bundle of the fake repository. */
export function bundle(text: string = SKILL_TEXT): BundleEntry[] {
  return [{ path: 'SKILL.md', kind: 'file', bytes: new TextEncoder().encode(text) }]
}

/** The canonical hash of a bundle, the value a client signs. */
export function hashOf(entries: BundleEntry[]): Hex {
  return bundleIdentity(entries).canonicalBundleHash
}

/** A signature of a request for a bundle. */
export function signedRequest(options: {
  bundleHash: Hex
  address?: string
  nonce?: string
  expiry?: number
  src?: string
}): Record<string, string> {
  return {
    bundleHash: options.bundleHash,
    src: options.src ?? SRC,
    address: options.address ?? ADDRESS,
    nonce: options.nonce ?? '1',
    expiry: String(options.expiry ?? NOW_SECONDS + 300),
    signature: SIGNATURE,
  }
}

/** The fake repository. It records every bundle that was asked for. */
export function fakeFetcher(entries: BundleEntry[]): RepoFetcher & { asked: SkillRef[] } {
  const asked: SkillRef[] = []
  return {
    asked,
    listSkillFolders: async () => ({ commit: 'a'.repeat(40), folders: [''] }),
    fetchBundle: async (ref: SkillRef) => {
      asked.push(ref)
      return entries
    },
  }
}

/** The fake chain. It answers what the test tells it to answer. */
export function fakeChain(options: { signer?: Address | null; holder?: boolean } = {}): ChainReader {
  const signer = options.signer === undefined ? (ADDRESS as Address) : options.signer
  return {
    isAgentIdHolder: async () => options.holder ?? true,
    recoverSigner: async () => signer,
  }
}

/** The fake worker. It records every run it was asked for. */
export interface FakeWorker extends WorkerClient {
  started: string[]
  answered: string[]
  /** Every request the worker was given, so a test can read what the worker received. */
  requests: WorkerRunRequest[]
  /** The answer the worker gives for the next run, or null when the worker knows nothing. */
  status: (runId: string) => Promise<WorkerRunStatus | null>
}

/**
 * The fake worker.
 *
 * `refuse` makes the worker refuse a run with a reason, `unreachable` makes it fail to answer, and
 * `answer` gives the status of a run. `healthy` is the answer of the health check of the worker.
 */
export function fakeWorker(options: {
  refuse?: 'DAILY_LIMIT' | 'BUSY'
  unreachable?: boolean
  healthy?: boolean
  answer?: (runId: string) => WorkerRunStatus | null
} = {}): FakeWorker {
  const started: string[] = []
  const answered: string[] = []
  const requests: WorkerRunRequest[] = []
  return {
    started,
    answered,
    requests,
    status: async (runId: string) => {
      answered.push(runId)
      if (options.unreachable === true) throw new WorkerUnavailable('The sandbox worker could not be reached.')
      if (options.answer !== undefined) return options.answer(runId)
      return null
    },
    health: async () => {
      if (options.unreachable === true) throw new WorkerUnavailable('The sandbox worker could not be reached.')
      return options.healthy ?? true
    },
    async start(request: WorkerRunRequest): Promise<void> {
      started.push(request.runId)
      requests.push(request)
      if (options.refuse !== undefined) throw new WorkerRefused(options.refuse)
    },
  }
}

/** The sandbox service of a test, with everything it needs. */
export interface SandboxFixture {
  app: Hono
  worker: FakeWorker
  fetcher: ReturnType<typeof fakeFetcher>
}

/** Builds the service of a test, with the fake chain, the fake repository and the fake worker. */
export function sandboxFixture(
  db: Db,
  options: {
    signer?: Address | null
    holder?: boolean
    entries?: BundleEntry[]
    worker?: FakeWorker
    probeSetVersion?: string
    modelId?: string
    token?: string | null
  } = {},
): SandboxFixture {
  const worker = options.worker ?? fakeWorker()
  const fetcher = fakeFetcher(options.entries ?? bundle())
  const { app } = testApp(db, {
    now: () => NOW,
    sandbox: {
      sql: db,
      now: () => NOW,
      chain: fakeChain({ ...(options.signer === undefined ? {} : { signer: options.signer }), ...(options.holder === undefined ? {} : { holder: options.holder }) }),
      skills: {
        fetcher,
        ...(options.token === null ? {} : { token: options.token ?? 'g'.repeat(32) }),
      },
      probeSetVersion: options.probeSetVersion ?? 'v1',
      modelId: options.modelId ?? 'model-1',
    },
  })
  return { app, worker, fetcher }
}
