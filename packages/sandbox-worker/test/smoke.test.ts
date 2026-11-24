import { expect, test } from 'vitest'
import { completedSmoke } from '../scripts/smokeReport'
import { request } from './runFixtures'

const result = { schemaVersion: 1, bundleHash: request.bundleHash, probeSetVersion: request.probeSetVersion,
  modelId: request.modelId, startedAt: '2026-11-25T12:00:00.000Z', finishedAt: '2026-11-25T12:00:01.000Z',
  status: 'INCOMPLETE', probes: [] }
const status = { runId: request.runId, state: 'done', probes: [], result }

test.each([401, 500, undefined])('a completed run with failed upload %s fails the smoke validation', (uploadStatus) => {
  expect(() => completedSmoke(status, uploadStatus)).toThrow()
})

test('an upload success without a persisted evidence URI fails the smoke validation', () => {
  expect(() => completedSmoke(status, 200)).toThrow()
})

test('a persisted public IPFS URI and successful upload complete the smoke validation', () => {
  expect(completedSmoke({ ...status, evidenceURI: `ipfs://Qm${'a'.repeat(44)}` }, 200).result?.status).toBe('INCOMPLETE')
})
