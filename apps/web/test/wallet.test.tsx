import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const wagmi = vi.hoisted(() => ({
  connect: vi.fn(), disconnect: vi.fn(), switchChain: vi.fn(),
  connectors: [] as { uid: string; id: string; name: string }[],
  connectStatus: { isPending: false },
}))
vi.mock('wagmi', () => ({
  useConnect: () => ({ mutate: wagmi.connect, ...wagmi.connectStatus }),
  useConnectors: () => wagmi.connectors,
  useDisconnect: () => ({ mutate: wagmi.disconnect }),
  useSwitchChain: () => ({ mutate: wagmi.switchChain, isPending: false }),
}))
const state = vi.hoisted(() => ({ value: { kind: 'no-wallet', isLoading: false, recheck: () => {} } as Record<string, unknown> }))
vi.mock('../lib/chain/userState', () => ({ useUserState: () => state.value }))
vi.mock('../lib/chain/config', () => ({
  expectedChainId: 56,
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

test('ConnectPrompt lists the connectors and connects the chosen one', async () => {
  const onClose = vi.fn()
  render(<ConnectPrompt onClose={onClose} />)
  expect(screen.getByRole('button', { name: /Browser wallet/ })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: /WalletConnect/ }))
  expect(wagmi.connect).toHaveBeenCalledWith({ connector: wagmi.connectors[1] }, expect.objectContaining({ onSuccess: expect.any(Function) }))
  wagmi.connect.mock.calls[0]![1].onSuccess()
  expect(onClose).toHaveBeenCalled()
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
