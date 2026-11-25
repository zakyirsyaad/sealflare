import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const ADDRESS_FIELDS = ['chainId', 'agentId', 'core', 'court', 'vault']

// The local file is gitignored and the BNB Chain file appears after the Core release.
// Only known fields reach the client bundle; a file that does not parse is passed through so the app reports it.
function readAddresses(name: string): string | undefined {
  const path = fileURLToPath(new URL(`../../shared/abi/${name}`, import.meta.url))
  if (!existsSync(path)) return undefined
  const raw = readFileSync(path, 'utf8')
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return JSON.stringify(Object.fromEntries(ADDRESS_FIELDS.filter(field => field in parsed).map(field => [field, parsed[field]])))
  } catch {
    return raw
  }
}
const local = readAddresses('addresses.local.json')
const bsc = readAddresses('addresses.bsc.json')
const bscTestnet = readAddresses('addresses.bsc-testnet.json')

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  env: {
    ...(local ? { NEXT_PUBLIC_ADDRESSES_LOCAL: local } : {}),
    ...(bsc ? { NEXT_PUBLIC_ADDRESSES_BSC: bsc } : {}),
    ...(bscTestnet ? { NEXT_PUBLIC_ADDRESSES_BSC_TESTNET: bscTestnet } : {}),
  },
}
export default config
