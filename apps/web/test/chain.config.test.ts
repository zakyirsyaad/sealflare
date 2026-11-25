import { expect, test } from 'vitest'
import { createWagmiConfig } from '../lib/chain/config'

test('the wallet config knows every chain the app can be set to, including BNB testnet', () => {
  const ids = createWagmiConfig().chains.map(chain => chain.id)
  for (const id of [56, 97, 31337]) expect(ids).toContain(id)
})

test('the QR connector exists only when a WalletConnect project id is set', () => {
  expect(createWagmiConfig(undefined).connectors.map(connector => connector.id)).not.toContain('walletConnect')
  expect(createWagmiConfig('a-public-project-id').connectors.map(connector => connector.id)).toContain('walletConnect')
})
