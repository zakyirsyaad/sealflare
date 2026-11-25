import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { getAddress } from 'viem'
import { ScanReport } from '@sealflare/shared/schemas'

const scanContract = vi.fn()
const scanSkill = vi.fn()
const environment = vi.hoisted(() => ({ failure: null as Error | null }))
vi.mock('../server/scanner', () => ({
  getScanEnvironment: () => {
    if (environment.failure) throw environment.failure
    return environmentOf()
  },
}))
function environmentOf() {
  return {
    scanner: { scanContract, scanSkill },
    rpc: {},
    explorer: {},
    repo: {},
    now: () => new Date('2026-11-25T03:00:00.000Z'),
  }
}

const { POST: postContract } = await import('../app/api/scan/contract/route')
const { POST: postSkill } = await import('../app/api/scan/skill/route')

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'
const REPORT = ScanReport.parse({
  schemaVersion: 1,
  targetType: 'SMART_CONTRACT',
  targetId: '0x2207d8fe3c025a72d53ae6bc382300fad26674f30e0eebb2026fe35545f4ece2',
  source: { kind: 'contract', address: ADDRESS, codehash: `0x${'11'.repeat(32)}`, blockNumber: '52000000' },
  scannedAt: '2026-11-25T03:00:00.000Z',
  checks: ['source_verified', 'admin_functions', 'proxy_eip1967', 'proxy_beacon', 'proxy_eip1167', 'delegatecall_opcode', 'dry_run'].map(id => ({ id, status: 'passed' })),
  findings: [],
  flags: 0,
  suggestedVerdict: 'SAFE',
})

function request(body: unknown): Request {
  return new Request('http://localhost/api/scan/contract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('the scan API', () => {
  test('a valid address returns a ScanReport in an envelope', async () => {
    scanContract.mockResolvedValue(REPORT)
    const response = await postContract(request({ address: ADDRESS }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ success: true, data: REPORT })
  })

  test.each([
    ['NO_CODE_AT_ADDRESS', 404],
    ['REPO_NOT_PUBLIC', 404],
    ['NO_SKILL_FOUND', 404],
    ['MULTIPLE_SKILL_FOLDERS', 409],
    ['BUNDLE_TOO_LARGE', 413],
    ['RATE_LIMITED', 429],
    ['RPC_UNAVAILABLE', 503],
  ])('a %s scan error becomes an error envelope with status %i', async (code, status) => {
    const { ScanError } = await import('@sealflare/shared/schemas')
    scanContract.mockRejectedValue(new ScanError(code as never, 'scan failed'))
    const response = await postContract(request({ address: ADDRESS }))
    expect(response.status).toBe(status)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.error.code).toBe(code)
  })

  test('MULTIPLE_SKILL_FOLDERS returns the folder list in details', async () => {
    const { ScanError } = await import('@sealflare/shared/schemas')
    scanSkill.mockRejectedValue(new ScanError('MULTIPLE_SKILL_FOLDERS', 'Choose a skill folder.', { folders: ['a', 'b'] }))
    const response = await postSkill(request({ url: 'https://github.com/owner/repo' }))
    const body = await response.json()
    expect(body.error.details.folders).toEqual(['a', 'b'])
  })

  test('a body that is not JSON, or fails the schema, is BAD_REQUEST', async () => {
    for (const body of ['not json', {}, { address: 'nope' }]) {
      const response = await postContract(request(body))
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('BAD_REQUEST')
    }
  })

  test('an unexpected throw is INTERNAL with no stack trace or secret in the body', async () => {
    scanContract.mockRejectedValue(new Error('RPC_URLS=https://secret.example/key'))
    const response = await postContract(request({ address: ADDRESS }))
    expect(response.status).toBe(500)
    const text = JSON.stringify(await response.json())
    expect(text).not.toContain('secret.example')
    expect(text).not.toContain('stack')
    expect(JSON.parse(text).error.code).toBe('INTERNAL')
  })

  test('a skill scan asks the scanner for the repository the link names', async () => {
    scanSkill.mockResolvedValue({ ...REPORT, targetType: 'AI_SKILL_BUNDLE' })
    const response = await postSkill(request({ url: 'https://github.com/owner/repo', path: 'skills/alpha' }))
    expect(response.status).toBe(200)
    expect(scanSkill).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'repo', path: 'skills/alpha' }),
      expect.anything(),
    )
  })

  test('a skill link pinned to a commit reaches the scanner with that commit', async () => {
    scanSkill.mockResolvedValue({ ...REPORT, targetType: 'AI_SKILL_BUNDLE' })
    const sha = 'a'.repeat(40)
    await postSkill(request({ url: `https://github.com/owner/repo/tree/${sha}`, path: 'skills/alpha' }))
    expect(scanSkill).toHaveBeenLastCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'repo', commit: sha, path: 'skills/alpha' }),
      expect.anything(),
    )
    await postSkill(request({ url: 'https://github.com/owner/repo/tree/main' }))
    expect(scanSkill).toHaveBeenLastCalledWith(expect.objectContaining({ branch: 'main' }), expect.anything())
  })

  test.each([
    ['contract', () => postContract(request({ address: ADDRESS }))],
    ['skill', () => postSkill(request({ url: 'https://github.com/owner/repo' }))],
  ])('a scan environment that cannot be built is an INTERNAL envelope on the %s route, never a verdict', async (_name, call) => {
    environment.failure = new Error('Invalid environment variables: SCANNER')
    try {
      const response = await call()
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body).toEqual({ success: false, error: { code: 'INTERNAL', message: 'The scan could not be completed.' } })
      expect(JSON.stringify(body)).not.toContain('SCANNER')
    } finally {
      environment.failure = null
    }
  })

  test('a mixed-case address with a bad checksum is refused, as the Scan screen refuses it', async () => {
    scanContract.mockClear()
    const good = getAddress(ADDRESS)
    const flipped = good.replace(/[a-f]/i, letter => (letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase()))
    const bad = flipped
    expect(bad).not.toBe(good)
    const response = await postContract(request({ address: bad }))
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INPUT_NOT_RECOGNIZED')
    expect(scanContract).not.toHaveBeenCalled()
  })

  test('an address with a valid checksum, all lowercase or all uppercase is scanned', async () => {
    scanContract.mockResolvedValue(REPORT)
    for (const address of [getAddress(ADDRESS), ADDRESS, `0x${ADDRESS.slice(2).toUpperCase()}`]) {
      expect((await postContract(request({ address }))).status).toBe(200)
    }
  })

  test('a contract address sent to the skill endpoint is refused', async () => {
    const response = await postSkill(request({ url: ADDRESS }))
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INPUT_NOT_RECOGNIZED')
  })

  test('only server/scanner.ts reads SCANNER', () => {
    const root = process.cwd()
    const files = [
      ...readdirSync(`${root}/server`).map(name => `server/${name}`),
      ...readdirSync(`${root}/app/api`, { recursive: true })
        .filter(name => String(name).endsWith('.ts'))
        .map(name => `app/api/${name}`),
    ]
    const readers = files.filter(file => readFileSync(`${root}/${file}`, 'utf8').includes('SCANNER'))
    expect(readers).toEqual(['server/scanner.ts'])
  })
})
