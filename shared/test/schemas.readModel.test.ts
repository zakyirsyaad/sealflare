import { describe, expect, test } from 'vitest'
import type { ZodType } from 'zod'
import {
  ActivityResponse,
  AttestationsListResponse,
  BountiesListResponse,
  BountyDetailResponse,
  ChallengeDetailResponse,
  ChallengesListResponse,
  GuardianDetailResponse,
  GuardiansListResponse,
  ListQuery,
  TargetDetailResponse,
  TargetsListResponse,
} from '../schemas'
import { loadJson } from './helpers'

const loadApi = (name: string) => loadJson<Record<string, unknown>>(`api/${name}.json`)
const dataOf = (fixture: Record<string, unknown>) => fixture.data as Record<string, unknown>
const patched = (fixture: Record<string, unknown>, dataPatch: Record<string, unknown>) => ({
  ...fixture,
  data: { ...dataOf(fixture), ...dataPatch },
})

const ADDRESS = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'
const TX_HASH = `0x${'ab'.repeat(32)}`

test.each<[string, ZodType]>([
  ['targets.list', TargetsListResponse],
  ['target.detail', TargetDetailResponse],
  ['guardians.list', GuardiansListResponse],
  ['guardian.detail', GuardianDetailResponse],
  ['challenges.list', ChallengesListResponse],
  ['challenge.detail', ChallengeDetailResponse],
  ['bounties.list', BountiesListResponse],
  ['bounty.detail', BountyDetailResponse],
  ['activity', ActivityResponse],
])('%s matches its schema', (name, schema) => {
  expect(schema.safeParse(loadApi(name)).error?.issues).toBeUndefined()
})

describe('read envelopes', () => {
  test('a read answer without meta.finalizedBlock is rejected', () => {
    const fixture = loadApi('target.detail')
    expect(TargetDetailResponse.safeParse({ success: true, data: dataOf(fixture) }).success).toBe(false)
    expect(TargetDetailResponse.safeParse({ ...fixture, meta: {} }).success).toBe(false)
    expect(TargetDetailResponse.safeParse({ ...fixture, meta: { page: { total: 1, page: 1, limit: 20 } } }).success).toBe(false)
    expect(TargetDetailResponse.safeParse(fixture).success).toBe(true)
  })
  test('a list answer without meta.page is rejected', () => {
    const fixture = loadApi('targets.list')
    expect(TargetsListResponse.safeParse({ ...fixture, meta: { finalizedBlock: '52000123' } }).success).toBe(false)
    expect(TargetsListResponse.safeParse(fixture).success).toBe(true)
  })
  test('an error answer needs no meta and uses the read error codes', () => {
    expect(TargetDetailResponse.safeParse({ success: false, error: { code: 'NOT_FOUND', message: 'No such target.' } }).success).toBe(true)
    expect(TargetsListResponse.safeParse({ success: false, error: { code: 'BAD_REQUEST', message: 'Bad filter.' } }).success).toBe(true)
    expect(TargetDetailResponse.safeParse({ success: false, error: { code: 'QUOTA_EXHAUSTED', message: 'x' } }).success).toBe(false)
  })
})

describe('indexed target sources', () => {
  const detail = loadApi('target.detail')
  const list = loadApi('targets.list')
  const [skill, contract] = dataOf(list).items as Record<string, unknown>[]
  if (!skill || !contract) throw new Error('Expected skill and contract fixtures')

  test('a skill with an unknown source is returned in the list and detail', () => {
    const unknownSource = { ...skill, src: null }
    const listResult = TargetsListResponse.parse(patched(list, { items: [unknownSource, contract] }))
    const detailResult = TargetDetailResponse.parse(patched(detail, { src: null }))
    expect(listResult).toMatchObject({ data: { items: [unknownSource, contract] } })
    expect(detailResult).toMatchObject({ data: { targetId: skill.targetId, src: null } })
  })

  test.each([
    ['a contract address on a skill', { ...skill, src: contract.src }],
    ['a pinned skill reference on a contract', { ...contract, src: skill.src }],
    ['a null source on a contract', { ...contract, src: null }],
    ['an unpinned skill source', { ...skill, src: 'gh:acme/skills@main:swap-helper' }],
    ['an omitted source', { ...skill, src: undefined }],
  ])('the list and detail reject %s', (_name, target) => {
    expect(TargetsListResponse.safeParse(patched(list, { items: [target] })).success).toBe(false)
    expect(TargetDetailResponse.safeParse(patched(detail, target)).success).toBe(false)
  })
})

describe('commit phase secrecy', () => {
  test('a challenge in the commit phase cannot expose any juror vote direction', () => {
    const fixture = loadApi('challenge.detail')
    const jurors = dataOf(fixture).jurors as Record<string, unknown>[]
    for (const uphold of [true, false]) {
      const exposed = jurors.map((juror, index) => (index === 0 ? { ...juror, uphold } : juror))
      expect(ChallengeDetailResponse.safeParse(patched(fixture, { jurors: exposed })).success).toBe(false)
    }
    expect(ChallengeDetailResponse.safeParse(fixture).success).toBe(true)
  })
  test('a challenge past the commit phase may carry vote directions', () => {
    const fixture = loadApi('challenge.detail')
    const jurors = (dataOf(fixture).jurors as Record<string, unknown>[]).map((juror) => ({ ...juror, revealed: true, uphold: true }))
    expect(ChallengeDetailResponse.safeParse(patched(fixture, { phase: 'REVEAL', jurors })).success).toBe(true)
  })
})

describe('amounts and timestamps', () => {
  test('an amount that is not a decimal integer string is rejected', () => {
    const detail = loadApi('target.detail')
    for (const bond of [0.5, '0.5', '1e18', '-1', '01', '']) {
      expect(TargetDetailResponse.safeParse(patched(detail, { bond })).success).toBe(false)
    }
    expect(TargetDetailResponse.safeParse(patched(detail, { bond: '0' })).success).toBe(true)
    expect(TargetDetailResponse.safeParse(patched(detail, { bond: '500000000000000000' })).success).toBe(true)
    const bounty = loadApi('bounty.detail')
    expect(BountyDetailResponse.safeParse(patched(bounty, { amount: 0.5 })).success).toBe(false)
    expect(BountyDetailResponse.safeParse(patched(bounty, { amount: '0.5' })).success).toBe(false)
    expect(ActivityResponse.safeParse(patched(loadApi('activity'), { balance: '0.5' })).success).toBe(false)
    const payouts = [{ recipient: ADDRESS, amount: '0.5' }]
    expect(ChallengeDetailResponse.safeParse(patched(loadApi('challenge.detail'), { payouts })).success).toBe(false)
  })
  test('a timestamp that is not an ISO datetime string is rejected', () => {
    const detail = loadApi('target.detail')
    for (const lastVoteAt of ['yesterday', '2026-11-22', '2026-11-22T15:00:00', 1795400000]) {
      expect(TargetDetailResponse.safeParse(patched(detail, { lastVoteAt })).success).toBe(false)
    }
    const challenge = loadApi('challenge.detail')
    expect(ChallengeDetailResponse.safeParse(patched(challenge, { commitEndsAt: 'soon' })).success).toBe(false)
    expect(ActivityResponse.safeParse(patched(loadApi('activity'), { history: [] })).success).toBe(true)
  })
})

describe('list queries', () => {
  test('a list query caps limit at 100 and rejects a malformed address filter', () => {
    expect(ListQuery.safeParse({}).success).toBe(true)
    expect(ListQuery.safeParse({ page: 2, limit: 100, address: ADDRESS, type: 'AI_SKILL_BUNDLE', tier: 'COMMUNITY_SAFE' }).success).toBe(true)
    expect(ListQuery.safeParse({ limit: 101 }).success).toBe(false)
    expect(ListQuery.safeParse({ limit: 0 }).success).toBe(false)
    expect(ListQuery.safeParse({ limit: 1.5 }).success).toBe(false)
    expect(ListQuery.safeParse({ page: 0 }).success).toBe(false)
    for (const address of ['0x12', 'not-an-address', `0x${'z'.repeat(40)}`]) {
      expect(ListQuery.safeParse({ address }).success).toBe(false)
    }
    expect(ListQuery.safeParse({ type: 'NFT' }).success).toBe(false)
    expect(ListQuery.safeParse({ tier: 'SAFE' }).success).toBe(false)
  })
})

describe('signal breakdown', () => {
  test('the signal breakdown never collapses into one number', () => {
    const fixture = loadApi('target.detail')
    const signal = dataOf(fixture).signal as Record<string, unknown>
    expect(TargetDetailResponse.safeParse(patched(fixture, { signal: 42 })).success).toBe(false)
    expect(TargetDetailResponse.safeParse(patched(fixture, { signal: { newIds: signal.newIds } })).success).toBe(false)
    expect(TargetDetailResponse.safeParse(patched(fixture, { signal: { guardians: signal.guardians } })).success).toBe(false)
    expect(TargetDetailResponse.safeParse(patched(fixture, { signal: { newIds: 5, guardians: 3 } })).success).toBe(false)
    expect(TargetDetailResponse.safeParse(fixture).success).toBe(true)
  })
})

describe('attestations list', () => {
  const row = {
    index: 0,
    guardian: ADDRESS,
    verdict: 'SAFE',
    flags: 0,
    weight: 2,
    safeOrdinal: 1,
    shortProof: '',
    evidenceURI: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    txHash: TX_HASH,
    at: '2026-11-22T04:00:00.000Z',
    settled: true,
    castDuringDispute: false,
  }
  const answer = {
    success: true,
    data: { items: [row] },
    meta: { finalizedBlock: '52000123', page: { total: 1, page: 1, limit: 20 } },
  }
  test('a page of attestation rows parses', () => {
    expect(AttestationsListResponse.safeParse(answer).error?.issues).toBeUndefined()
  })
  test('an attestation with an empty evidence URI is returned', () => {
    const withoutEvidence = { ...row, evidenceURI: '' }
    const result = AttestationsListResponse.parse(patched(answer, { items: [withoutEvidence] }))
    expect(result).toMatchObject({ data: { items: [withoutEvidence] } })
  })
  test('a row with an unknown verdict or a malformed transaction hash is rejected', () => {
    expect(AttestationsListResponse.safeParse({ ...answer, data: { items: [{ ...row, verdict: 'MAYBE' }] } }).success).toBe(false)
    expect(AttestationsListResponse.safeParse({ ...answer, data: { items: [{ ...row, txHash: '0x12' }] } }).success).toBe(false)
  })
  test('a short proof above 512 bytes is rejected', () => {
    expect(AttestationsListResponse.safeParse({ ...answer, data: { items: [{ ...row, shortProof: 'x'.repeat(512) }] } }).success).toBe(true)
    expect(AttestationsListResponse.safeParse({ ...answer, data: { items: [{ ...row, shortProof: 'x'.repeat(513) }] } }).success).toBe(false)
  })
})
