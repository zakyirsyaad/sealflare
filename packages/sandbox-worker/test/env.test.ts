import { expect, test } from 'vitest'
import { loadEnv } from '../src/env'

export const envSource = {
  WORKER_BEARER_KEY: 'fixture-worker-bearer-value-32-characters',
  ANTHROPIC_API_KEY: 'fixture-provider-credential', PINATA_JWT: 'fixture-upload-credential',
  DAILY_LLM_CALLS: '1000', RUN_DIR: '/tmp/sealflare-worker-tests', PORT: '8787',
}

test('environment values are validated and numeric limits are converted without mutating input', () => {
  const before = { ...envSource }
  expect(loadEnv(envSource)).toEqual({ ...envSource, DAILY_LLM_CALLS: 1000, PORT: 8787 })
  expect(envSource).toEqual(before)
})

test.each(['WORKER_BEARER_KEY', 'ANTHROPIC_API_KEY', 'PINATA_JWT', 'DAILY_LLM_CALLS', 'RUN_DIR', 'PORT'] as const)
  ('missing %s stops startup and reports the variable without revealing credentials', (variable) => {
    const source: Record<string, string | undefined> = { ...envSource, [variable]: undefined }
    let message = ''
    try { loadEnv(source) } catch (error) { message = String(error) }
    expect(message).toContain(variable)
    for (const key of ['WORKER_BEARER_KEY', 'ANTHROPIC_API_KEY', 'PINATA_JWT'] as const) expect(message).not.toContain(envSource[key])
  })

test.each(['short-fixture', ' '.repeat(32), 'x'.repeat(31), '🦭'.repeat(32)])('invalid bearer value is rejected without showing it', (value) => {
  expect(() => loadEnv({ ...envSource, WORKER_BEARER_KEY: value })).toThrow(/WORKER_BEARER_KEY/)
  try { loadEnv({ ...envSource, WORKER_BEARER_KEY: value }) } catch (error) { expect(String(error)).not.toContain(value) }
})

test.each(['0', '-1', '1.5', 'Infinity', 'NaN', '1e3', '9007199254740992'])('invalid daily limit %s is rejected', (value) => {
  expect(() => loadEnv({ ...envSource, DAILY_LLM_CALLS: value })).toThrow(/DAILY_LLM_CALLS/)
})

test.each(['0', '65536', '1.5', 'not-a-port'])('invalid port %s is rejected', (PORT) => {
  expect(() => loadEnv({ ...envSource, PORT })).toThrow(/PORT/)
})

test.each(['', 'relative/path', '/tmp/\0bad'])('invalid run directory %j is rejected', (RUN_DIR) => {
  expect(() => loadEnv({ ...envSource, RUN_DIR })).toThrow(/RUN_DIR/)
})

test('a configured HTTPS Anthropic-compatible endpoint is retained for the operator-selected gateway', () => {
  expect(loadEnv({ ...envSource, ANTHROPIC_BASE_URL: 'https://gateway.example' }).ANTHROPIC_BASE_URL).toBe('https://gateway.example')
})

test.each(['http://gateway.example', 'https://user:pass@gateway.example', 'https://gateway.example/?key=credential'])
  ('unsafe provider URL %s is rejected without echoing it', (ANTHROPIC_BASE_URL) => {
    expect(() => loadEnv({ ...envSource, ANTHROPIC_BASE_URL })).toThrow(/ANTHROPIC_BASE_URL/)
  })
