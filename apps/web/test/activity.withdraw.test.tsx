import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('wagmi', async () => await import('./activity.wagmi'))

import { WithdrawButton } from '../components/activity/WithdrawButton'
import { ACCOUNT, chain, resetActivity } from './activity.fixtures'
import { copy } from '../lib/copy'

/** The account of the wallet, as the button reads it. */
const ACCOUNT_ADDRESS = ACCOUNT as `0x${string}`

beforeEach(() => {
  resetActivity()
})

test('the button is free again when a new balance comes after the whole balance went out', async () => {
  // The whole balance was withdrawn, so the balance reads zero and the result stays on the screen.
  const onWithdrawn = vi.fn()
  const view = render(
    <WithdrawButton account={ACCOUNT_ADDRESS} balance={15_000_000_000_000_000n} onWithdrawn={onWithdrawn} />,
  )
  await userEvent.click(screen.getByRole('button', { name: copy.activity.withdraw }))
  expect(await screen.findByText(copy.common.waitingFinality)).toBeInTheDocument()
  view.rerender(<WithdrawButton account={ACCOUNT_ADDRESS} balance={0n} onWithdrawn={onWithdrawn} />)
  expect(screen.getByText(copy.common.waitingFinality)).toBeInTheDocument()
  // A new balance came, so the account can take it out again.
  view.rerender(<WithdrawButton account={ACCOUNT_ADDRESS} balance={30_000_000_000_000_000n} onWithdrawn={onWithdrawn} />)
  await userEvent.click(await screen.findByRole('button', { name: copy.activity.withdraw }))
  expect(chain.write).toHaveBeenCalledTimes(2)
})
