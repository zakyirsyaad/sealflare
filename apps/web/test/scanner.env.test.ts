import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const server = {
  INTERNAL_URL: 'https://internal.example.com', INTERNAL_KEY: 'test-only-key', RPC_URLS: 'https://rpc.example.com',
  BSCSCAN_KEY: 'test', GITHUB_TOKEN: 'test', PINATA_JWT: 'test',
}
const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'

/**
 * How long a case of this file may take.
 *
 * Every case loads the whole scanner again, so a busy machine needs more than the default five
 * seconds. The cases themselves take a fraction of a second.
 */
const TIMEOUT = 30_000

async function load() {
  vi.resetModules()
  return (await import('../server/scanner')).getScanEnvironment
}

describe('choosing the scanner', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    for (const [key, value] of Object.entries(server)) process.env[key] = value
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  test.each([undefined, '', 'Real', 'MOCK', ' real', 'fake'])(
    'SCANNER=%j refuses to build a scanner, so no verdict can come from the mock by accident',
    async value => {
      if (value === undefined) delete process.env.SCANNER
      else process.env.SCANNER = value
      const getScanEnvironment = await load()
      expect(() => getScanEnvironment()).toThrow('SCANNER')
    },
    TIMEOUT,
  )

  test('the error names the variable and nothing else from the environment', async () => {
    process.env.SCANNER = 'Real'
    const getScanEnvironment = await load()
    expect(() => getScanEnvironment()).toThrow(/^Invalid environment variables: SCANNER$/)
  })

  test('SCANNER=mock answers from the fixtures and says so for the address that was asked for', async () => {
    process.env.SCANNER = 'mock'
    const getScanEnvironment = await load()
    const { scanner, rpc, explorer } = getScanEnvironment()
    const report = await scanner.scanContract(ADDRESS, { rpc, explorer })
    expect(report.source).toMatchObject({ kind: 'contract', address: ADDRESS })
  })

  test('SCANNER=real needs the full server environment and builds the real adapters from it', async () => {
    // The mock does not read the server environment, so the same environment builds under the
    // mock and refuses to build under the real scanner. A regression that built the mock under
    // SCANNER=real would answer from the fixtures and pass every other assertion in this file.
    delete process.env.GITHUB_TOKEN
    process.env.SCANNER = 'mock'
    const mockEnvironment = await load()
    expect(() => mockEnvironment()).not.toThrow()

    process.env.SCANNER = 'real'
    const realEnvironment = await load()
    expect(() => realEnvironment()).toThrow('GITHUB_TOKEN')
  })

  test('a failed attempt is not cached: fixing the variable fixes the next call', async () => {
    delete process.env.SCANNER
    const getScanEnvironment = await load()
    expect(() => getScanEnvironment()).toThrow()
    process.env.SCANNER = 'mock'
    expect(() => getScanEnvironment()).not.toThrow()
  })
})
