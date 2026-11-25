import type { Hono } from 'hono'
import { vi } from 'vitest'
import { loadEnv } from '../src/env'
import { createBudget } from '../src/budget'
import { createStore } from '../src/store'
import type { LlmClient } from '../src/llm'
import { request, runDirectory } from './runFixtures'

export const bearer = 'fixture-worker-bearer-value-32-characters'
export const credentials = { WORKER_BEARER_KEY: bearer, ANTHROPIC_API_KEY: 'fixture-provider-credential',
  PINATA_JWT: 'fixture-upload-credential', DAILY_LLM_CALLS: '1000', PORT: '8787' }
export const fixtureCid = `ipfs://Qm${'a'.repeat(44)}`
export function httpDeps() {
  const dir = runDirectory()
  return { env: loadEnv({ ...credentials, RUN_DIR: dir }), store: createStore(dir),
    budget: createBudget({ dailyCalls: 1000 }),
    llm: { step: vi.fn<LlmClient['step']>(async () => ({ toolCalls: [], text: 'Done.', done: true })) },
    upload: vi.fn(async (_text: string) => fixtureCid),
  }
}
export function post(app: Hono, body: unknown = request, authorization = `Bearer ${bearer}`) {
  return app.request('/runs', { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
export async function statusOf(app: Hono, runId = request.runId) {
  const response = await app.request(`/runs/${runId}`, { headers: { authorization: `Bearer ${bearer}` } })
  return { response, body: await response.json() }
}
