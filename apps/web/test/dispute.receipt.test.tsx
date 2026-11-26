import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('wagmi', async () => (await import('./dispute.mocks')).wagmiModule)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/app' }))
vi.mock('../lib/chain/userState', async () => (await import('./dispute.mocks')).userStateModule)
vi.mock('../lib/chain/config', async () => (await import('./dispute.mocks')).configModule)
vi.mock('../lib/api/client', async () => (await import('./dispute.mocks')).clientModule())

import { ChallengePanel } from '../components/dispute/ChallengePanel'
import { copy } from '../lib/copy'
import { resetDispute, wagmi } from './dispute.mocks'
import { address, scan, targetId, txHash } from './dispute.fixtures'

function panel() {
  return render(
    <ChallengePanel targetId={targetId} targetType="SMART_CONTRACT" label={address} scan={scan()} onClose={() => {}} />,
  )
}

async function toReview() {
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
  await userEvent.type(screen.getByLabelText(copy.dispute.statementLabel), 'The owner can mint without a cap.')
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
}

const submit = () => userEvent.click(screen.getByRole('button', { name: copy.dispute.submit }))

beforeEach(() => {
  resetDispute()
  wagmi.reads.current = { nextExpireForfeitBps: 2000 }
})

// ---- the receipt of the transaction -----------------------------------------------------------

test('the receipt is waited for on the chain the transaction was sent on', async () => {
  panel()
  await toReview()
  await submit()
  await waitFor(() => expect(wagmi.receiptParams.at(-1)?.hash).toBe(txHash), { timeout: 5_000 })
  const waited = wagmi.receiptParams.at(-1)
  expect(waited?.hash).toBe(txHash)
  expect(waited?.chainId).toBe(56)
}, 20_000)

test('a transaction the wallet cancelled is a failure, never "Waiting for finality"', async () => {
  panel()
  await toReview()
  await submit()
  await waitFor(() => expect(wagmi.receiptParams.at(-1)?.onReplaced).toBeTypeOf('function'), { timeout: 5_000 })
  act(() => wagmi.receiptParams.at(-1)?.onReplaced?.({ reason: 'cancelled' }))
  expect(await screen.findByRole('alert', {}, { timeout: 5_000 })).toHaveTextContent(copy.errors.txReplaced)
  expect(screen.queryByText(copy.common.waitingFinality)).toBeNull()
}, 20_000)

test('a receipt of another transaction is a failure, never "Waiting for finality"', async () => {
  wagmi.receipt.current = {
    isSuccess: true,
    isError: false,
    error: null,
    data: { status: 'success', transactionHash: `0x${'cd'.repeat(32)}` },
  } as never
  panel()
  await toReview()
  await submit()
  expect(await screen.findByRole('alert', {}, { timeout: 5_000 })).toHaveTextContent(copy.errors.txReplaced)
  expect(screen.queryByText(copy.common.waitingFinality)).toBeNull()
}, 20_000)

test('a retry after a cancelled transaction is not failed by the replacement of the old one', async () => {
  const second = `0x${'ef'.repeat(32)}`
  wagmi.writeContractAsync.mockReset()
  wagmi.writeContractAsync.mockResolvedValueOnce(txHash).mockResolvedValueOnce(second)
  panel()
  await toReview()
  await submit()
  await waitFor(() => expect(wagmi.receiptParams.at(-1)?.onReplaced).toBeTypeOf('function'), { timeout: 5_000 })
  act(() => wagmi.receiptParams.at(-1)?.onReplaced?.({ reason: 'cancelled' }))
  expect(await screen.findByRole('alert', {}, { timeout: 5_000 })).toHaveTextContent(copy.errors.txReplaced)
  await userEvent.click(screen.getByRole('button', { name: copy.common.retry }))
  await waitFor(() => expect(wagmi.writeContractAsync).toHaveBeenCalledTimes(2), { timeout: 5_000 })
  expect(screen.queryByRole('alert')).toBeNull()
}, 20_000)

test('a speed-up is linked under the hash that was mined', async () => {
  const mined = `0x${'cd'.repeat(32)}`
  panel()
  await toReview()
  await submit()
  await waitFor(() => expect(wagmi.receiptParams.at(-1)?.onReplaced).toBeTypeOf('function'), { timeout: 5_000 })
  act(() => {
    wagmi.receipt.current = {
      isSuccess: true,
      isError: false,
      error: null,
      data: { status: 'success', transactionHash: mined },
    } as never
    wagmi.receiptParams.at(-1)?.onReplaced?.({ reason: 'repriced' })
  })
  const link = await screen.findByRole('link', { name: copy.target.transaction }, { timeout: 5_000 })
  expect(link).toHaveAttribute('href', `https://bscscan.com/tx/${mined}`)
}, 20_000)
