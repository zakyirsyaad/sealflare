import { beforeEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'

vi.mock('wagmi', async () => await import('./activity.wagmi'))
vi.mock('../lib/chain/userState', async () => {
  const { account } = await import('./activity.fixtures')
  return { useUserState: () => account.state }
})
vi.mock('../lib/chain/config', async () => {
  const { modules } = await import('./activity.fixtures')
  return {
    get expectedChainId() {
      return 56
    },
    get modulesLive() {
      return modules.live
    },
    agentIdUrl: 'https://agent-id.example/get',
  }
})
vi.mock('next/navigation', () => ({ usePathname: () => '/app/me' }))

import MyActivityPage from '../app/app/me/page'
import { AppHeader } from '../components/AppHeader'
import { ActivityProvider } from '../lib/activity/ActivityProvider'
import {
  ACCOUNT,
  OTHER,
  PASSED,
  TARGET,
  TX_HASH,
  VAULT,
  account,
  activity,
  answer,
  chain,
  historyItem,
  modules,
  need,
  resetActivity,
} from './activity.fixtures'
import { copy } from '../lib/copy'

/** The screen of the account, with the rows of the account read once for the whole application. */
function renderActivity(ui: ReactElement) {
  return render(<ActivityProvider>{ui}</ActivityProvider>)
}

beforeEach(() => {
  resetActivity()
})

test('needs action comes first, ordered by urgency, and disappears when empty', async () => {
  answer.current = activity({
    needsAction: [
      need({ kind: 'XP_CLAIMABLE', challengeId: undefined, dueAt: undefined, detail: 'Your early Safe vote held for 48 hours.' }),
      need({ dueAt: '2099-06-01T00:00:00.000Z' }),
    ],
    history: [historyItem()],
  })
  renderActivity(<MyActivityPage />)
  await screen.findByRole('heading', { name: copy.activity.needsAction })
  const headings = screen.getAllByRole('heading', { level: 2 }).map(node => node.textContent)
  expect(headings[0]).toBe(copy.activity.needsAction)
  const rows = screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)
  expect(rows[0]).toContain('Reveal your vote')
  expect(rows[1]).toBe(copy.activity.claimTitle)

  cleanup()
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await screen.findByRole('heading', { name: copy.activity.history })
  expect(screen.queryByRole('heading', { name: copy.activity.needsAction })).toBeNull()
})

test('a due reveal names the stake at risk and links to the reveal', async () => {
  answer.current = activity({ needsAction: [need()], history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText('Your 0.005 BNB stake is lost if you do not reveal in time.')).toBeInTheDocument()
  const link = screen.getByRole('link', { name: copy.activity.revealAction })
  expect(link).toHaveAttribute('href', '/app/disputes/12')
  expect(screen.getByText(/due in/)).toBeInTheDocument()
})

test('a reveal whose window closed is gone from the panel and from the mark', async () => {
  // The chain says the window closed, so the row is not shown and the mark does not count it.
  answer.current = activity({ needsAction: [need({ dueAt: PASSED })], history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await screen.findByRole('heading', { name: copy.activity.history })
  expect(screen.queryByRole('heading', { name: copy.activity.needsAction })).toBeNull()
  expect(screen.queryByRole('link', { name: copy.activity.revealAction })).toBeNull()
  expect(screen.queryByRole('button', { name: /items need action/ })).toBeNull()
})

test('the balance comes from Vault.balanceOf and Withdraw sends the whole balance', async () => {
  answer.current = activity({ balance: '9990000000000000000', history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText('0.015')).toBeInTheDocument()
  expect(screen.queryByText('9.99')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: copy.activity.withdraw }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'withdraw', args: [], address: VAULT }),
    ),
  )
  expect(screen.getByText(copy.activity.withdrawGas)).toBeInTheDocument()
})

test('Withdraw is not offered with a zero balance', async () => {
  chain.balanceOf = 0n
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.balanceEmpty)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.activity.withdraw })).toBeNull()
})

test('standing shows score, vote weight, distance to the next weight and attestations left today', async () => {
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText('Vote weight 2 of 5')).toBeInTheDocument()
  expect(screen.getByText('13 more reputation to reach weight 3.')).toBeInTheDocument()
  expect(screen.getByText('12')).toBeInTheDocument()
  expect(screen.getByText('3 of 5')).toBeInTheDocument()
})

test('a standing that does not know the score does not say the weight is the highest', async () => {
  // The weight is read, but the score is not, so the distance to the next weight is not known.
  chain.pending = ['getGuardian']
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText('Vote weight 2 of 5')).toBeInTheDocument()
  expect(screen.queryByText(copy.activity.topWeight)).toBeNull()
})

test('Claim calls settle for the page of attestations that contains mine and says it costs gas', async () => {
  answer.current = activity({
    needsAction: [need({ kind: 'XP_CLAIMABLE', challengeId: undefined, dueAt: undefined, detail: 'Your early Safe vote held for 48 hours.' })],
    history: [historyItem()],
  })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.claimAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'settle', args: [TARGET, 50, 50], address: expect.any(String) }),
    ),
  )
  expect(screen.getByText(copy.activity.settleGas)).toBeInTheDocument()
})

test('a claim reads the standing of the account again', async () => {
  // The claim changes the score of the account on the chain, so the standing is read again.
  answer.current = activity({
    needsAction: [need({ kind: 'XP_CLAIMABLE', challengeId: undefined, dueAt: undefined, detail: 'Your early Safe vote held for 48 hours.' })],
    history: [historyItem()],
  })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.claimAction }))
  await waitFor(() => expect(chain.refetches.getGuardian ?? 0).toBeGreaterThan(0))
})

test('a claim that the chain does not offer says why instead of nothing', async () => {
  chain.pendingSettlement = 0
  answer.current = activity({
    needsAction: [need({ kind: 'XP_CLAIMABLE', challengeId: undefined, dueAt: undefined, detail: 'Your early Safe vote held for 48 hours.' })],
    history: [historyItem()],
  })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.claimEmpty)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.activity.claimAction })).toBeNull()
})

test('a claim that the chain already settled is not offered again', async () => {
  chain.getAttestation = { settled: true }
  answer.current = activity({
    needsAction: [need({ kind: 'XP_CLAIMABLE', challengeId: undefined, dueAt: undefined, detail: 'Your early Safe vote held for 48 hours.' })],
    history: [historyItem()],
  })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.claimSettled)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.activity.claimAction })).toBeNull()
})

test('a chain read that fails shows the failed state of the claim button', async () => {
  chain.readsFailed = true
  answer.current = activity({
    needsAction: [need({ kind: 'XP_CLAIMABLE', challengeId: undefined, dueAt: undefined, detail: 'Your early Safe vote held for 48 hours.' })],
    history: [historyItem()],
  })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.claimFailed)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.activity.claimAction })).toBeNull()
})

test('an account with no history sees one invitation: scan a first target', async () => {
  answer.current = activity()
  renderActivity(<MyActivityPage />)
  const invitation = await screen.findByRole('link', { name: copy.activity.scanFirst })
  expect(invitation).toHaveAttribute('href', '/app')
  expect(screen.getAllByRole('link', { name: copy.activity.scanFirst })).toHaveLength(1)
  expect(screen.queryByRole('table')).toBeNull()
})

test('the wallet button badge equals the number of needs-action items', async () => {
  answer.current = activity({ needsAction: [need(), need({ kind: 'CAN_CLOSE' })], history: [historyItem()] })
  renderActivity(<AppHeader />)
  await waitFor(() => expect(screen.getByRole('button', { name: /2 items need action/ })).toBeInTheDocument())
  expect(screen.getByText('2')).toBeInTheDocument()
})

test('the mark says that the number is not known when the rows could not be read', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('The activity could not be read.') }))
  answer.current = activity({ needsAction: [need()], history: [historyItem()] })
  renderActivity(<AppHeader />)
  await waitFor(() => expect(screen.getByRole('button', { name: /not known/ })).toBeInTheDocument())
  expect(screen.getByText('?')).toBeInTheDocument()
})

test('this page asks for a wallet and shows nothing personal without one', async () => {
  account.state = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  renderActivity(<MyActivityPage />)
  expect(screen.getByText(copy.activity.needWallet)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.nav.connectWallet })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: copy.activity.history })).toBeNull()
  expect(screen.queryByRole('heading', { name: copy.activity.balanceToWithdraw })).toBeNull()
  expect(screen.queryByRole('heading', { name: copy.activity.standing })).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

test('the rows of the previous account are not shown while the next one loads', async () => {
  let current = activity({ needsAction: [need()], history: [historyItem()] })
  let calls = 0
  const pending: { release: (() => void) | null } = { release: null }
  vi.stubGlobal('fetch', vi.fn(() => {
    calls += 1
    if (calls === 1) return Promise.resolve({ json: async () => current })
    return new Promise(resolve => {
      pending.release = () => resolve({ json: async () => current })
    })
  }))
  const { rerender } = renderActivity(<MyActivityPage />)
  expect(await screen.findByRole('heading', { level: 3, name: /Reveal your vote/ })).toBeInTheDocument()
  account.state = { kind: 'holder', address: OTHER, isLoading: false, isError: false, recheck: () => {} }
  current = activity({ history: [historyItem()] })
  rerender(
    <ActivityProvider>
      <MyActivityPage />
    </ActivityProvider>,
  )
  expect(screen.queryByRole('heading', { level: 3, name: /Reveal your vote/ })).toBeNull()
  pending.release?.()
  expect(await screen.findByRole('heading', { name: copy.activity.history })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { level: 3, name: /Reveal your vote/ })).toBeNull()
})

test('a chain read that fails shows the failed state and no balance', async () => {
  chain.readsFailed = true
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.balanceFailed)).toBeInTheDocument()
  expect(screen.getByText(copy.activity.standingFailed)).toBeInTheDocument()
  expect(screen.queryByText('0.015')).toBeNull()
  expect(screen.queryByText('Vote weight 2 of 5')).toBeNull()
})

test('a deployment that names no contract shows the failed state', async () => {
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({ chainId: 56 })
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.balanceFailed)).toBeInTheDocument()
  expect(screen.getByText(copy.activity.standingFailed)).toBeInTheDocument()
  expect(screen.queryByText('0.015')).toBeNull()
})

test('a waiting transaction shows the link to the transaction', async () => {
  chain.receipt = { isSuccess: false, isError: false, data: null, error: null }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.withdraw }))
  expect(await screen.findByRole('button', { name: copy.common.waitingConfirmation })).toBeDisabled()
  const link = await screen.findByRole('link', { name: copy.target.transaction })
  expect(link).toHaveAttribute('href', `https://bscscan.com/tx/${TX_HASH}`)
})

test('the withdrawal can be used again once the chain shows the new balance', async () => {
  // Every transaction has a hash of its own, and the chain shows the balance that is left.
  let calls = 0
  chain.write.mockImplementation(async () => {
    calls += 1
    chain.balanceOf = 30_000_000_000_000_000n
    return `0x${calls.toString(16).padStart(64, '0')}`
  })
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.withdraw }))
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.withdraw }))
  await waitFor(() => expect(chain.write).toHaveBeenCalledTimes(2))
})

test('the withdrawal keeps its confirmation after the balance reads zero', async () => {
  chain.write.mockImplementation(async () => {
    chain.balanceOf = 0n
    return TX_HASH
  })
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.withdraw }))
  expect(await screen.findByText(copy.common.waitingFinality)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.target.transaction })).toHaveAttribute(
    'href',
    `https://bscscan.com/tx/${TX_HASH}`,
  )
})

test('the count of the needs-action panel is the count of the mark on the wallet button', async () => {
  answer.current = activity({ needsAction: [need(), need({ kind: 'CAN_CLOSE' })], history: [historyItem()] })
  renderActivity(
    <>
      <AppHeader />
      <MyActivityPage />
    </>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: /2 items need action/ })).toBeInTheDocument())
  const panel = await screen.findByRole('region', { name: copy.activity.needsAction })
  expect(within(panel).getByText('2')).toBeInTheDocument()
})

test('the mark on the wallet button is read again after a settlement', async () => {
  answer.current = activity({
    needsAction: [need({ kind: 'XP_CLAIMABLE', challengeId: undefined, dueAt: undefined, detail: 'Your early Safe vote held for 48 hours.' })],
    history: [historyItem()],
  })
  renderActivity(
    <>
      <AppHeader />
      <MyActivityPage />
    </>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: /1 item needs action/ })).toBeInTheDocument())
  answer.current = activity({ history: [historyItem()] })
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.claimAction }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /1 item needs action/ })).toBeNull())
})

test('the balance shows the note of ux.md 4.2 while the vault is not open yet', async () => {
  modules.live = false
  process.env.NEXT_PUBLIC_ADDRESSES_BSC = JSON.stringify({ chainId: 56, agentId: ACCOUNT, core: TARGET })
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText(copy.common.modulesNotLive)).toBeInTheDocument()
  expect(screen.queryByText(copy.activity.balanceFailed)).toBeNull()
  expect(screen.queryByRole('button', { name: copy.activity.withdraw })).toBeNull()
})

test('a wallet without an Agent ID is offered the way to get one', async () => {
  account.state = { kind: 'no-agent-id', address: ACCOUNT, isLoading: false, isError: false, recheck: () => {} }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText(copy.wallet.agentWhy)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: copy.wallet.getAgentId })).toHaveAttribute('href', 'https://agent-id.example/get')
  expect(screen.getByRole('button', { name: copy.wallet.checkAgain })).toBeInTheDocument()
})
