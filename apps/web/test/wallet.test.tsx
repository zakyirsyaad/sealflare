import { beforeEach, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserRejectedRequestError } from 'viem'

const wagmi = vi.hoisted(() => ({
  connect: vi.fn(), disconnect: vi.fn(), switchChain: vi.fn(),
  connectors: [] as { uid: string; id: string; name: string }[],
  connectStatus: { isPending: false },
  switchStatus: { isPending: false, error: null as unknown },
}))
vi.mock('wagmi', () => ({
  useConnect: () => ({ mutate: wagmi.connect, ...wagmi.connectStatus }),
  useConnectors: () => wagmi.connectors,
  useDisconnect: () => ({ mutate: wagmi.disconnect }),
  useSwitchChain: () => ({ mutate: wagmi.switchChain, ...wagmi.switchStatus }),
}))
const state = vi.hoisted(() => ({ value: { kind: 'no-wallet', isLoading: false, recheck: () => {} } as Record<string, unknown> }))
vi.mock('../lib/chain/userState', () => ({ useUserState: () => state.value }))
const chain = vi.hoisted(() => ({ id: 56 }))
vi.mock('../lib/chain/config', () => ({
  get expectedChainId() { return chain.id },
  modulesLive: false,
  agentIdUrl: 'https://agent-id.example/get',
}))

import { NoAgentId } from '../components/wallet/NoAgentId'
import { WalletButton } from '../components/wallet/WalletButton'
import { WalletMenu } from '../components/wallet/WalletMenu'
import { WrongNetwork } from '../components/wallet/WrongNetwork'
import { ConnectPrompt } from '../components/wallet/ConnectPrompt'
import { moduleGate } from '../lib/chain/modules'

const me = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

beforeEach(() => {
  vi.clearAllMocks()
  state.value = { kind: 'no-wallet', isLoading: false, recheck: () => {} }
  wagmi.connectors = [{ uid: '1', id: 'injected', name: 'Browser wallet' }, { uid: '2', id: 'walletConnect', name: 'WalletConnect' }]
  wagmi.switchStatus = { isPending: false, error: null }
  chain.id = 56
})

test('NoAgentId offers both paths and a "Check again" that re-reads without reloading', async () => {
  const recheck = vi.fn()
  const otherWallet = vi.fn()
  render(<NoAgentId recheck={recheck} onOtherWallet={otherWallet} agentIdUrl="https://agent-id.example/get" />)
  expect(screen.getByText('You need an Agent ID.')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'I have one on another wallet' }))
  expect(otherWallet).toHaveBeenCalledTimes(1)
  const link = screen.getByRole('link', { name: 'Get an Agent ID' })
  expect(link).toHaveAttribute('href', 'https://agent-id.example/get')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
  expect(recheck).toHaveBeenCalledTimes(1)
})

test('NoAgentId without a configured link shows no dead link', () => {
  render(<NoAgentId recheck={() => {}} onOtherWallet={() => {}} />)
  expect(screen.queryByRole('link', { name: 'Get an Agent ID' })).toBeNull()
  expect(screen.getByText('Get an Agent ID')).toBeVisible()
})

test('NoAgentId explains why an Agent ID is needed', () => {
  render(<NoAgentId recheck={() => {}} onOtherWallet={() => {}} />)
  expect(screen.getByText(/attestations are tied to an Agent ID/i)).toBeVisible()
})

test('WrongNetwork switches to the configured chain with one button', async () => {
  render(<WrongNetwork />)
  await userEvent.click(screen.getByRole('button', { name: 'Switch to BNB Smart Chain' }))
  expect(wagmi.switchChain).toHaveBeenCalledWith({ chainId: 56 })
})

test.each([[56, 'Switch to BNB Smart Chain'], [97, 'Switch to BNB Smart Chain testnet'], [31337, 'Switch to local Anvil chain']])(
  'the switch button names the expected chain %i, not always BNB mainnet', async (id, label) => {
    chain.id = id
    render(<WrongNetwork />)
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(wagmi.switchChain).toHaveBeenCalledWith({ chainId: id })
  })

test('connecting starts on the expected chain, also on testnet', async () => {
  chain.id = 97
  render(<ConnectPrompt onClose={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: /WalletConnect/ }))
  expect(wagmi.connect.mock.calls[0]![0]).toMatchObject({ chainId: 97 })
})

test('a failed switch says so instead of only re-enabling the button', () => {
  wagmi.switchStatus = { isPending: false, error: new Error('Chain not configured') }
  render(<WrongNetwork />)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not switch networks. Try again.')
})

test('a rejected switch shows no error message', () => {
  wagmi.switchStatus = { isPending: false, error: new UserRejectedRequestError(new Error('User denied')) }
  render(<WrongNetwork />)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('ConnectPrompt lists the connectors and connects the chosen one', async () => {
  const onClose = vi.fn()
  render(<ConnectPrompt onClose={onClose} />)
  expect(screen.getByRole('button', { name: /Browser wallet/ })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: /WalletConnect/ }))
  expect(wagmi.connect).toHaveBeenCalledWith({ connector: wagmi.connectors[1], chainId: 56 }, expect.objectContaining({ onSuccess: expect.any(Function) }))
  wagmi.connect.mock.calls[0]![1].onSuccess()
  expect(onClose).toHaveBeenCalled()
})

test('the generic injected connector reads as a browser wallet, not as a developer term', () => {
  wagmi.connectors = [{ uid: '1', id: 'injected', name: 'Injected' }]
  render(<ConnectPrompt onClose={() => {}} />)
  expect(screen.getByRole('button', { name: 'Browser wallet' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Injected' })).toBeNull()
})

test('the generic injected connector is hidden when a discovered wallet is already listed', () => {
  wagmi.connectors = [{ uid: '1', id: 'injected', name: 'Injected' }, { uid: '2', id: 'io.metamask', name: 'MetaMask' }]
  render(<ConnectPrompt onClose={() => {}} />)
  expect(screen.getByRole('button', { name: 'MetaMask' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Browser wallet' })).toBeNull()
})

test('ConnectPrompt describes the QR path for a mobile wallet', () => {
  render(<ConnectPrompt onClose={() => {}} />)
  expect(screen.getByText(/mobile wallet.*QR/i)).toBeVisible()
})

test('the wallet button without a wallet opens the connect prompt', async () => {
  render(<WalletButton />)
  await userEvent.click(screen.getByRole('button', { name: 'Connect wallet' }))
  expect(screen.getByRole('dialog', { name: /connect/i })).toBeInTheDocument()
})

test('on the wrong network the wallet button becomes the switch button', () => {
  state.value = { kind: 'wrong-network', isLoading: false, recheck: () => {} }
  render(<WalletButton />)
  expect(screen.getByRole('button', { name: 'Switch to BNB Smart Chain' })).toBeVisible()
})

test('the wallet button shows the count of things needing action without opening the menu', () => {
  state.value = { kind: 'holder', address: me, attestationsLeft: 3, isLoading: false, recheck: () => {} }
  render(<WalletButton pendingCount={3} />)
  const button = screen.getByRole('button', { name: /0x7099…79C8/ })
  expect(within(button).getByText('3')).toBeVisible()
  expect(button).toHaveAccessibleName(/3 .*need.*action/i)
  expect(screen.queryByRole('menu')).toBeNull()
})

test('no badge is drawn when nothing needs action', () => {
  state.value = { kind: 'holder', address: me, attestationsLeft: 3, isLoading: false, recheck: () => {} }
  render(<WalletButton pendingCount={0} />)
  expect(within(screen.getByRole('button', { name: /0x7099…79C8/ })).queryByText('0')).toBeNull()
})

test('a wallet without an Agent ID still gets the menu, so it can reach Publish and Disconnect', async () => {
  state.value = { kind: 'no-agent-id', address: me, isLoading: false, recheck: () => {} }
  render(<WalletButton />)
  await userEvent.click(screen.getByRole('button', { name: /0x7099…79C8/ }))
  expect(screen.getByRole('menu')).toBeVisible()
})

test('while the Agent ID check is unknown or failed, the wallet button still shows the address and the menu', async () => {
  state.value = { kind: 'checking', address: me, isLoading: false, isError: true, error: 'No contract addresses for chain 56.', recheck: () => {} }
  render(<WalletButton />)
  await userEvent.click(screen.getByRole('button', { name: /0x7099…79C8/ }))
  expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeVisible()
})

test('a menu that loses focus with no new target stays open, so a click on Disconnect still lands (Safari and Firefox on macOS)', async () => {
  state.value = { kind: 'holder', address: me, attestationsLeft: 3, isLoading: false, recheck: () => {} }
  render(<WalletButton />)
  await userEvent.click(screen.getByRole('button', { name: /0x7099…79C8/ }))
  fireEvent.focusOut(screen.getByRole('menuitem', { name: 'Publish' }), { relatedTarget: null })
  expect(screen.getByRole('menu')).toBeVisible()
  await userEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }))
  expect(wagmi.disconnect).toHaveBeenCalledTimes(1)
})

test('pressing Tab inside the menu closes it and does not pull focus back to the button', async () => {
  state.value = { kind: 'holder', address: me, attestationsLeft: 3, isLoading: false, recheck: () => {} }
  render(<WalletButton />)
  const trigger = screen.getByRole('button', { name: /0x7099…79C8/ })
  await userEvent.click(trigger)
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Publish' }), { key: 'Tab' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(trigger).not.toHaveFocus()
})

test('Escape closes the menu and returns focus to the button', async () => {
  state.value = { kind: 'holder', address: me, attestationsLeft: 3, isLoading: false, recheck: () => {} }
  render(<WalletButton />)
  const trigger = screen.getByRole('button', { name: /0x7099…79C8/ })
  await userEvent.click(trigger)
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Publish' }), { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(trigger).toHaveFocus()
})

test('a menu left open while the network changed does not reopen when the user returns to the right chain', async () => {
  state.value = { kind: 'holder', address: me, attestationsLeft: 3, isLoading: false, recheck: () => {} }
  const { rerender } = render(<WalletButton />)
  await userEvent.click(screen.getByRole('button', { name: /0x7099…79C8/ }))
  expect(screen.getByRole('menu')).toBeVisible()
  state.value = { kind: 'wrong-network', isLoading: false, recheck: () => {} }
  rerender(<WalletButton />)
  state.value = { kind: 'holder', address: me, attestationsLeft: 3, isLoading: false, recheck: () => {} }
  rerender(<WalletButton />)
  expect(screen.queryByRole('menu')).toBeNull()
})

test('on the wrong network the user can still disconnect inside the app', async () => {
  state.value = { kind: 'wrong-network', isLoading: false, recheck: () => {} }
  render(<WalletButton />)
  await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
  expect(wagmi.disconnect).toHaveBeenCalledTimes(1)
})

test('the menu links to My activity and Publish and disconnects', async () => {
  const onClose = vi.fn()
  render(<WalletMenu pendingCount={2} onClose={onClose} />)
  expect(screen.getByRole('menuitem', { name: /My activity/ })).toHaveAttribute('href', '/app/me')
  expect(screen.getByRole('menuitem', { name: 'Publish' })).toHaveAttribute('href', '/app/publish')
  await userEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }))
  expect(wagmi.disconnect).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalled()
})

test('modules not live disables dispute, bounty and bond actions with the fixed sentence', () => {
  expect(moduleGate(false)).toEqual({ disabled: true, reason: 'Opens when the dispute and vault contracts go live.' })
  expect(moduleGate(true)).toEqual({ disabled: false, reason: null })
})
