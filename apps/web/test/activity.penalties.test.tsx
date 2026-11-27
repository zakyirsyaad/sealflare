import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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
import { ActivityProvider } from '../lib/activity/ActivityProvider'
import {
  TARGET,
  TX_HASH,
  activity,
  answer,
  chain,
  historyItem,
  modules,
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

test('Apply penalties pages through in chunks and shows how many remain', async () => {
  chain.penalties = { [TARGET]: 120 }
  chain.write.mockImplementation(async () => {
    chain.penalties[TARGET] = 70
    return TX_HASH
  })
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText('120 penalties remain')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'applyPenalties', args: [TARGET, 0, 50] }),
    ),
  )
  expect(await screen.findByText('70 penalties remain')).toBeInTheDocument()
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenLastCalledWith(
      expect.objectContaining({ functionName: 'applyPenalties', args: [TARGET, 50, 50] }),
    ),
  )
})

test('a page of penalties starts where the chain says there is a safe vote to charge', async () => {
  // The first fifty attestations are charged already, so a page that starts at zero would cost
  // gas for nothing.
  for (let index = 0; index < 50; index += 1) chain.attestations[index] = { verdict: 0, penalized: true }
  chain.penalties = { [TARGET]: 120 }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'applyPenalties', args: [TARGET, 50, 50] }),
    ),
  )
})

test('one penalty that remains is named in the singular', async () => {
  chain.penalties = { [TARGET]: 1 }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.penaltiesRemainOne)).toBeInTheDocument()
  expect(screen.queryByText('1 penalties remain')).toBeNull()
})

test('the last page of penalties covers only the attestations that are left', async () => {
  // Every transaction has a hash of its own, so the button is free again after each page.
  let pages = 0
  chain.write.mockImplementation(async () => {
    pages += 1
    return `0x${pages.toString(16).padStart(64, '0')}`
  })
  chain.penalties = { [TARGET]: 120 }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenLastCalledWith(expect.objectContaining({ args: [TARGET, 0, 50] })),
  )
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenLastCalledWith(expect.objectContaining({ args: [TARGET, 50, 50] })),
  )
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenLastCalledWith(expect.objectContaining({ args: [TARGET, 100, 20] })),
  )
  expect(await screen.findByText(copy.activity.penaltiesCovered)).toBeInTheDocument()
})

test('the last page of penalties says how many penalties it applied', async () => {
  let pages = 0
  chain.write.mockImplementation(async () => {
    pages += 1
    chain.penalties[TARGET] = 70
    return `0x${pages.toString(16).padStart(64, '0')}`
  })
  chain.penalties = { [TARGET]: 120 }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  expect(await screen.findByText(/The last page applied 50 penalties/)).toBeInTheDocument()
})

test('the report of a page that clears a target stays on the screen', async () => {
  // The page clears the target, so the row of the target is gone, and the report stays.
  chain.write.mockImplementation(async () => {
    chain.penalties[TARGET] = 0
    return TX_HASH
  })
  chain.penalties = { [TARGET]: 120 }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  expect(await screen.findByText(/The last page applied 120 penalties/)).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: copy.activity.penaltiesPanel })).toBeNull()
})

test('a page of penalties that applied nothing says so', async () => {
  let pages = 0
  chain.write.mockImplementation(async () => {
    pages += 1
    return `0x${pages.toString(16).padStart(64, '0')}`
  })
  chain.penalties = { [TARGET]: 120 }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  expect(await screen.findByText(/The last page applied no penalty/)).toBeInTheDocument()
})

test('the last page of penalties waits for the chain before it says what it applied', async () => {
  // The chain answers the read after the page was mined, so the screen may not say what the page
  // applied before the new number has arrived.
  chain.holdReads = true
  chain.write.mockImplementation(async () => {
    chain.penalties[TARGET] = 70
    return TX_HASH
  })
  chain.penalties = { [TARGET]: 120 }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  expect(await screen.findByText(copy.common.waitingFinality)).toBeInTheDocument()
  expect(screen.queryByText(/The last page applied/)).toBeNull()
  chain.release?.()
  expect(await screen.findByText(/The last page applied 50 penalties/)).toBeInTheDocument()
})

test('a page of penalties that the wallet refused says nothing about what it applied', async () => {
  chain.write.mockRejectedValue({ code: 4001 })
  chain.penalties = { [TARGET]: 120 }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() => expect(chain.write).toHaveBeenCalled())
  expect(screen.queryByText(/The last page applied/)).toBeNull()
})

test('a target that cannot be read stops the pages of penalties', async () => {
  chain.penalties = { [TARGET]: 120 }
  chain.targetsFailed = true
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.penaltiesFailed)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.activity.penaltiesAction })).toBeNull()
})

test('the penalties show the note of ux.md 4.2 while the modules are not open yet', async () => {
  modules.live = false
  chain.penalties = { [TARGET]: 120 }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findAllByText(copy.common.modulesNotLive)).not.toHaveLength(0)
  expect(screen.getByRole('button', { name: copy.activity.penaltiesAction })).toBeDisabled()
})

test('the range of a page does not move past an attestation that could not be read', async () => {
  // The window of attestations cannot be read, so the screen does not know where the next page
  // starts, and it does not move past the window either: an attestation that was never read may
  // still be waiting for a penalty.
  chain.rangeFailed = true
  chain.penalties = { [TARGET]: 120 }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  expect(await screen.findByText(copy.activity.penaltiesFailed)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: copy.activity.penaltiesAction })).toBeNull()
  // The chain answers again, so the retry reads the window again.
  chain.rangeFailed = false
  await userEvent.click(screen.getByRole('button', { name: copy.common.retry }))
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() =>
    expect(chain.write).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'applyPenalties', args: [TARGET, 0, 50] }),
    ),
  )
})

test('the button waits for the range of the next page before it is free again', async () => {
  // The window of attestations is read again after the page, and the chain is slow to answer.
  chain.penalties = { [TARGET]: 120 }
  answer.current = activity({ history: [historyItem()] })
  renderActivity(<MyActivityPage />)
  const panel = await screen.findByRole('region', { name: copy.activity.penaltiesPanel })
  chain.holdRange = true
  await userEvent.click(within(panel).getByRole('button', { name: copy.activity.penaltiesAction }))
  await waitFor(() => expect(chain.write).toHaveBeenCalled())
  // The page was mined and the number that is left was read, so the button would be free again.
  // The range is not known yet, so the button waits instead of sending the page that was mined.
  await waitFor(() => expect(within(panel).getByText(copy.common.loading)).toBeInTheDocument())
  expect(within(panel).queryByRole('button', { name: copy.activity.penaltiesAction })).toBeNull()
  chain.release?.()
  expect(await within(panel).findByRole('button', { name: copy.activity.penaltiesAction })).toBeInTheDocument()
})
