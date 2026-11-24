import { expect, test, vi } from 'vitest'
import { createExplorerAdapter } from '../src/adapters/explorer'
import { ADDRESS, abiWith } from './contract.fixtures'

const result = (SourceCode = 'contract Token {}', ABI = JSON.stringify(abiWith('mint'))) => ({
  SourceCode, ABI, ContractName: 'Token', CompilerVersion: 'v0.8.28+commit.7893614a',
  OptimizationUsed: '1', Runs: '200', ConstructorArguments: '', EVMVersion: 'Default',
  Library: '', ContractFileName: 'Token.sol', LicenseType: 'MIT', Proxy: '0', Implementation: '', SwarmSource: '',
})
const ok = (entry = result()) => new Response(JSON.stringify({ status: '1', message: 'OK', result: [entry] }))

test('verified source returns files and a decoded ABI using Etherscan V2 chain 56', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => ok())
  const source = await createExplorerAdapter({ apiKey: 'test-secret', fetch: fetcher }).getSource(ADDRESS)
  expect(source).toEqual({ verified: true, files: [{ path: 'Token.sol', content: 'contract Token {}' }], abi: abiWith('mint') })
  const url = new URL(String(fetcher.mock.calls[0]![0]))
  expect(url.origin + url.pathname).toBe('https://api.etherscan.io/v2/api')
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ chainid: '56', module: 'contract',
    action: 'getsourcecode', address: ADDRESS, apikey: 'test-secret' })
})

test.each(['standard', 'wrapped', 'map'])('%s source bundles preserve every file', async (form) => {
  const files = { 'src/A.sol': { content: 'contract A {}' }, 'B.sol': { content: 'library B {}' } }
  const json = JSON.stringify(form === 'map' ? files : { language: 'Solidity', sources: files, settings: {} })
  const source = await createExplorerAdapter({ apiKey: 'key', fetch: async () => ok(result(form === 'wrapped' ? `{${json}}` : json)) })
    .getSource(ADDRESS)
  expect(source?.files).toEqual([{ path: 'src/A.sol', content: 'contract A {}' }, { path: 'B.sol', content: 'library B {}' }])
})

test('an explicitly unverified result is not an explorer outage', async () => {
  const explorer = createExplorerAdapter({ apiKey: 'key', fetch: async () => ok(result('', 'Contract source code not verified')) })
  expect(await explorer.getSource(ADDRESS)).toEqual({ verified: false, files: [] })
})

test.each(['http', 'rate-limit', 'network', 'non-json', 'malformed-source', 'empty-result', 'broken-abi'])('%s returns null', async (mode) => {
  const fetcher: typeof fetch = async () => {
    if (mode === 'network') throw Error('test-secret')
    if (mode === 'http') return new Response('oops', { status: 500 })
    if (mode === 'rate-limit') return new Response(JSON.stringify({ status: '0', message: 'NOTOK', result: 'Max rate limit reached' }))
    if (mode === 'non-json') return new Response('not JSON')
    if (mode === 'malformed-source') return ok(result('{{broken}'))
    if (mode === 'empty-result') return new Response(JSON.stringify({ status: '1', message: 'OK', result: [] }))
    return ok(result('contract Token {}', 'bad ABI'))
  }
  expect(await createExplorerAdapter({ apiKey: 'test-secret', fetch: fetcher }).getSource(ADDRESS)).toBeNull()
})

test('invalid addresses are refused before sending the key', async () => {
  const fetcher = vi.fn<typeof fetch>()
  await expect(createExplorerAdapter({ apiKey: 'key', fetch: fetcher }).getSource('0x12')).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
