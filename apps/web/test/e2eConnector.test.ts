import { beforeEach, expect, test, vi } from 'vitest'
import { foundry } from 'wagmi/chains'
import { e2eConnector } from '../lib/chain/e2eConnector'

vi.mock('../lib/env.public', () => ({ publicEnv: { NEXT_PUBLIC_CHAIN_ID: 31337 } }))

const ACCOUNT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

function build() {
  const config = { chains: [foundry], emitter: { emit: vi.fn() } }
  return e2eConnector()(config as never)
}

beforeEach(() => {
  window.__sealflareE2EAccount = ACCOUNT
})

test('the wallet of the suite connects on the local chain, with or without naming it', async () => {
  expect((await build().connect()).chainId).toBe(31337)
  expect((await build().connect({ chainId: 31337 })).chainId).toBe(31337)
})

test('the wallet of the suite refuses to report any chain but the local one', async () => {
  for (const chainId of [56, 97, 1]) {
    await expect(build().connect({ chainId })).rejects.toThrow(/local chain/)
  }
})
