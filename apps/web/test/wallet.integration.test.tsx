import { expect, test } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { bsc } from 'wagmi/chains'
import { mock } from 'wagmi/connectors'
import { WalletButton } from '../components/wallet/WalletButton'

const account = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const

function setup(options: { connectError?: boolean | Error } = {}) {
  const config = createConfig({
    chains: [bsc],
    connectors: [mock({ accounts: [account], features: { connectError: options.connectError ?? false } })],
    transports: { [bsc.id]: http('http://127.0.0.1:1') },
  })
  render(
    <WagmiProvider config={config}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <WalletButton />
      </QueryClientProvider>
    </WagmiProvider>,
  )
}

async function connect() {
  await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }))
  await userEvent.click(screen.getByRole('button', { name: /mock/i }))
  return screen.findByRole('button', { name: /0x7099…79C8/ })
}

test('the connect prompt closes after a real connection and does not come back after disconnect', async () => {
  setup()
  const trigger = await connect()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await userEvent.click(trigger)
  await userEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }))
  await screen.findByRole('button', { name: 'Connect wallet' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('without a WalletConnect connector the prompt does not promise a QR code', async () => {
  setup()
  await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }))
  expect(screen.queryByText(/QR/)).toBeNull()
})

test('a failed connection that is not a rejection says so instead of failing silently', async () => {
  setup({ connectError: new Error('Provider not found') })
  await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }))
  await userEvent.click(screen.getByRole('button', { name: /mock/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect. Try again or choose another wallet.')
})

test('rejecting the connection in the wallet shows no error', async () => {
  setup({ connectError: true })
  await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }))
  await userEvent.click(screen.getByRole('button', { name: /mock/i }))
  await waitFor(() => expect(screen.getByRole('button', { name: /mock/i })).toBeEnabled())
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

test('a connected wallet on a chain with no address file still shows its address and menu', async () => {
  setup()
  await userEvent.click(await connect())
  expect(screen.getByRole('menu')).toBeVisible()
})

test('closing the menu with Escape returns focus to the wallet button', async () => {
  setup()
  const trigger = await connect()
  await userEvent.click(trigger)
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('menu')).toBeNull()
  expect(trigger).toHaveFocus()
})

test('tabbing out of the menu closes it', async () => {
  setup()
  await userEvent.click(await connect())
  await userEvent.tab()
  await userEvent.tab()
  await userEvent.tab()
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
})
