import { expect, test } from 'vitest'
import { createWagmiConfig } from '../lib/chain/config'
import { chainName } from '../lib/chain/chains'

test('the wallet config knows every chain the app can be set to, including BNB testnet', () => {
  const ids = createWagmiConfig().chains.map(chain => chain.id)
  for (const id of [56, 97, 31337]) expect(ids).toContain(id)
})

test('the QR connector exists only when a WalletConnect project id is set', () => {
  expect(createWagmiConfig(undefined).connectors.map(connector => connector.id)).not.toContain('walletConnect')
  expect(createWagmiConfig('a-public-project-id').connectors.map(connector => connector.id)).toContain('walletConnect')
})

test('every supported chain has a plain name, and an unknown one falls back to its id', () => {
  expect(chainName(56)).toBe('BNB Smart Chain')
  expect(chainName(97)).toBe('BNB Smart Chain testnet')
  expect(chainName(31337)).toBe('local Anvil chain')
  expect(chainName(1)).toBe('Chain 1')
})
