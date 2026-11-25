import { serve } from '@hono/node-server'
import { randomBytes } from 'node:crypto'
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import { bundleIdentity, CONSTANTS, type BundleEntry } from '@sealflare/shared/rules'
import { PROBE_IDS, WorkerRunRequest, WorkerRunStatus } from '@sealflare/shared/schemas'
import { createAnthropicClient, type Usage } from '../src/llm'
import { createPinataUploader } from '../src/pinata'
import { createStore } from '../src/store'
import { createBudget } from '../src/budget'
import { createApp } from '../src/server'
import { loadEnv } from '../src/env'
import { PROBE_SET_VERSION } from '../src/probes'
import { completedSmoke } from './smokeReport'

function fixtureEntries(directory: string, prefix = ''): BundleEntry[] {
  return readdirSync(directory).sort().flatMap((name) => {
    const file = join(directory, name), path = prefix ? `${prefix}/${name}` : name, stat = lstatSync(file)
    if (stat.isSymbolicLink()) throw Error('Smoke fixtures must not contain symlinks.')
    return stat.isDirectory() ? fixtureEntries(file, path) : [{ path, kind: 'file' as const, bytes: new Uint8Array(readFileSync(file)) }]
  })
}

async function main(): Promise<void> {
  const model = z.string().min(1).max(80).parse(process.env.SMOKE_MODEL_ID), directory = mkdtempSync(join(tmpdir(), 'sealflare-live-'))
  const env = loadEnv({ ...process.env, RUN_DIR: directory, PORT: '8787', WORKER_BEARER_KEY: randomBytes(32).toString('hex'),
    DAILY_LLM_CALLS: process.env.SMOKE_CALL_LIMIT ?? String(PROBE_IDS.length * CONSTANTS.PROBE_RUNS * 8 * 2) })
  let calls = 0, usageReplies = 0, unknownUsageReplies = 0, tokens = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
  const observe = (usage: Usage) => {
    if (usage.inputTokens === null) { unknownUsageReplies++; return }
    usageReplies++
    for (const key of Object.keys(tokens) as (keyof typeof tokens)[]) tokens[key] += usage[key]
  }
  const client = createAnthropicClient({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL, onUsage: observe })
  let uploadSettled = false, uploadStatus: number | undefined
  const uploader = createPinataUploader({ jwt: env.PINATA_JWT, fetch: async (input, init) => {
    const response = await fetch(input, init); uploadStatus = response.status; return response
  } })
  const app = createApp({ env, store: createStore(directory), budget: createBudget({ dailyCalls: env.DAILY_LLM_CALLS }),
    llm: { step: (input) => { calls++; return client.step(input) } },
    upload: async (json) => { try { return await uploader(json) } finally { uploadSettled = true } } })
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  if (!server.listening) await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('Smoke listener unavailable.')
  const url = `http://127.0.0.1:${address.port}`, headers = { authorization: `Bearer ${env.WORKER_BEARER_KEY}` }
  const reports: unknown[] = []
  try {
    for (const name of ['clean', 'unlimited-approval']) {
      calls = 0; usageReplies = 0; unknownUsageReplies = 0; uploadSettled = false; uploadStatus = undefined
      tokens = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
      const root = new URL(`../../scanner-core/fixtures/skills/${name}/`, import.meta.url)
      const entries = fixtureEntries(fileURLToPath(root)), started = Date.now()
      const request = WorkerRunRequest.parse({ runId: `smoke-${name}`, bundleHash: bundleIdentity(entries).canonicalBundleHash,
        skillMd: readFileSync(new URL('SKILL.md', root), 'utf8'), probeSetVersion: PROBE_SET_VERSION, modelId: model })
      const accepted = await fetch(`${url}/runs`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(request) })
      if (accepted.status !== 202) throw Error('Smoke run was not accepted.')
      let status: WorkerRunStatus | undefined
      while (Date.now() - started < 900_000) {
        const response = await fetch(`${url}/runs/${request.runId}`, { headers })
        status = WorkerRunStatus.parse(await response.json())
        if (status.state === 'done' && uploadSettled) break
        await sleep(1000)
      }
      status = completedSmoke(status, uploadStatus)
      const report = { fixture: name, modelId: model, status: status.result!.status, failureCause: status.failure?.cause,
        llmCalls: calls, usageReplies, unknownUsageReplies, ...tokens, uploadStatus, evidenceURI: status.evidenceURI, durationMs: Date.now() - started }
      reports.push(report)
      console.log(JSON.stringify(report))
    }
    if (process.env.SMOKE_REPORT_PATH) writeFileSync(process.env.SMOKE_REPORT_PATH, JSON.stringify(reports, null, 2), { mode: 0o600 })
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }) }
}

main().catch(() => { console.error('Live smoke failed; check configured credentials, model, and provider availability.'); process.exitCode = 1 })
