import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const server = {
  INTERNAL_URL: 'https://internal.example.com', INTERNAL_KEY: 'test-only-key', RPC_URLS: 'https://rpc.example.com',
  BSCSCAN_KEY: 'test', GITHUB_TOKEN: 'test', PINATA_JWT: 'test',
}
const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'

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
    process.env.SCANNER = 'real'
    const getScanEnvironment = await load()
    expect(getScanEnvironment().rpc.getCode).not.toThrow
    delete process.env.GITHUB_TOKEN
    const again = await load()
    expect(() => again()).toThrow('GITHUB_TOKEN')
  })

  test('a failed attempt is not cached: fixing the variable fixes the next call', async () => {
    delete process.env.SCANNER
    const getScanEnvironment = await load()
    expect(() => getScanEnvironment()).toThrow()
    process.env.SCANNER = 'mock'
    expect(() => getScanEnvironment()).not.toThrow()
  })
})
