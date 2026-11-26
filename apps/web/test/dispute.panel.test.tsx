import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CONSTANTS, FLAGS } from '@sealflare/shared/rules'
import { evidenceHashOf } from '@sealflare/shared/schemas'

vi.mock('wagmi', async () => (await import('./dispute.mocks')).wagmiModule)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/app' }))
vi.mock('../lib/chain/userState', async () => (await import('./dispute.mocks')).userStateModule)
vi.mock('../lib/chain/config', async () => (await import('./dispute.mocks')).configModule)
vi.mock('../lib/api/client', async () => (await import('./dispute.mocks')).clientModule())

import { ChallengeAction } from '../components/dispute/ChallengeAction'
import { ChallengePanel } from '../components/dispute/ChallengePanel'
import { copy } from '../lib/copy'
import { config, resetDispute, state, uploadEvidence, wagmi } from './dispute.mocks'
import { COURT, CORE, ME, NOW, address, scan, targetId } from './dispute.fixtures'

function panel(overrides: Partial<Parameters<typeof ChallengePanel>[0]> = {}) {
  return render(
    <ChallengePanel targetId={targetId} targetType="SMART_CONTRACT" label={address} scan={scan()} onClose={() => {}} {...overrides} />,
  )
}

const unixOf = (date: Date) => BigInt(Math.floor(date.getTime() / 1000))

beforeEach(resetDispute)

afterEach(() => {
  vi.useRealTimers()
})

// ---- the challenge panel -------------------------------------------------------------------

test('the panel has three steps: flags, evidence, review', async () => {
  panel()
  expect(screen.getByText(copy.dispute.step[0])).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: copy.dispute.action })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: copy.dispute.flagsTitle })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
  expect(screen.getByText(copy.dispute.step[1])).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: copy.dispute.evidenceTitle })).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText(copy.dispute.statementLabel), 'The owner can mint without a cap.')
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
  expect(screen.getByText(copy.dispute.step[2])).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: copy.dispute.review })).toBeInTheDocument()
})

test('the flags of the scan are already ticked, and at least one flag is needed', async () => {
  panel()
  const unverified = screen.getByRole('checkbox', { name: 'Unverified source' })
  expect(unverified).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Hidden mint' })).not.toBeChecked()
  await userEvent.click(unverified)
  expect(screen.getByText(copy.dispute.needFlag)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.dispute.continue })).toBeDisabled()
})

async function toReview(statement = 'The owner can mint without a cap.') {
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
  await userEvent.type(screen.getByLabelText(copy.dispute.statementLabel), statement)
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.continue }))
}

test('the review step names the 0.01 BNB stake and all four endings with the money returned in each', async () => {
  panel()
  await toReview()
  expect(screen.getByText('0.01 BNB, held until the dispute ends')).toBeInTheDocument()
  expect(screen.getByText('Upheld: your 0.01 BNB comes back, plus half of the pool.')).toBeInTheDocument()
  expect(screen.getByText('Rejected: no BNB comes back, and you lose 5 XP.')).toBeInTheDocument()
  expect(screen.getByText('Tie: your 0.01 BNB comes back.')).toBeInTheDocument()
  expect(screen.getByText('Expired: 0.008 BNB of your 0.01 BNB comes back.')).toBeInTheDocument()
  expect(screen.getByText(copy.dispute.cooldownNote.replace('{days}', '7'))).toBeInTheDocument()
  expect(screen.getByText(copy.attest.twoApprovals)).toBeInTheDocument()
})

test('the cooldown follows every ending of a dispute but a danger verdict', async () => {
  panel()
  await toReview()
  expect(
    screen.getByText(
      'After a dispute that ends in any other way than a danger verdict, you cannot challenge this target again for 7 days.',
    ),
  ).toBeInTheDocument()
})

test.each([
  [2000, '20', '0.008'],
  [5000, '50', '0.005'],
  [10000, '100', '0'],
])('the review step states the forfeit share for this target: %s basis points is %s%%', async (bps, percent, back) => {
  wagmi.reads.current.nextExpireForfeitBps = bps
  panel()
  await toReview()
  expect(
    screen.getByText(copy.dispute.expireNote.replace('{min}', '3').replace('{percent}', percent)),
  ).toBeInTheDocument()
  expect(screen.getByText(`Expired: ${back} BNB of your 0.01 BNB comes back.`)).toBeInTheDocument()
  expect(wagmi.readCalls.some(call => call.functionName === 'nextExpireForfeitBps' && call.args?.[0] === targetId)).toBe(true)
})

test('without the forfeit share nothing can be signed', async () => {
  wagmi.reads.current.nextExpireForfeitBps = undefined
  panel()
  await toReview()
  expect(screen.getByText(copy.dispute.forfeitPending)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: copy.dispute.submit })).toBeDisabled()
})

test('the stake sent equals CHALLENGE_STAKE exactly', async () => {
  wagmi.receipt.current = { isSuccess: true, isError: false, error: null }
  panel()
  await toReview()
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.submit }))
  const written = wagmi.writeContractAsync.mock.calls[0]?.[0] as {
    functionName: string
    value: bigint
    address: string
    chainId: number
    account: string
    args: readonly unknown[]
  }
  expect(written.functionName).toBe('openChallenge')
  expect(written.value).toBe(CONSTANTS.CHALLENGE_STAKE)
  expect(written.address).toBe(COURT)
  expect(written.chainId).toBe(56)
  expect(written.account).toBe(ME)
  expect(written.args[0]).toBe(targetId)
  expect(written.args[1]).toBe(FLAGS.UNVERIFIED_SOURCE)
  const sent = uploadEvidence.mock.calls[0]?.[0] as { reportJson: string }
  expect(written.args[2]).toBe(evidenceHashOf(new TextEncoder().encode(sent.reportJson)))
  expect(written.args[4]).toBe('ipfs://bafycid')
  expect(await screen.findByText(copy.common.waitingFinality)).toBeInTheDocument()
})

// ---- the button on the target page ---------------------------------------------------------

type ActionProps = Parameters<typeof ChallengeAction>[0]

function action(overrides: Partial<ActionProps> = {}) {
  return render(
    <ChallengeAction
      targetId={targetId}
      targetType="SMART_CONTRACT"
      label={address}
      scan={scan()}
      tier="CAUTION_FLAGGED"
      activeChallengeId={null}
      {...overrides}
    />,
  )
}

test('the button opens the panel when nothing stands in the way', async () => {
  action()
  const button = screen.getByRole('button', { name: copy.dispute.action })
  expect(button).toBeEnabled()
  await userEvent.click(button)
  expect(screen.getByText(copy.dispute.step[0])).toBeInTheDocument()
})

test.each([
  ['an open challenge exists', 'link "View the open challenge"'],
  ['in cooldown', 'disabled with the end date'],
  ['confirmed danger', 'button not shown'],
  ['modules not live', 'disabled with the fixed sentence'],
])('%s: %s', async (situation) => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  if (situation === 'an open challenge exists') {
    wagmi.reads.current.activeChallengeOf = 12n
    action({ activeChallengeId: '12' })
    expect(screen.getByRole('link', { name: copy.dispute.viewOpen })).toHaveAttribute('href', '/app/disputes/12')
    expect(screen.queryByRole('button', { name: copy.dispute.action })).toBeNull()
  }
  if (situation === 'in cooldown') {
    wagmi.reads.current.cooldownEndsAt = unixOf(new Date('2026-12-04T00:00:00.000Z'))
    action()
    expect(screen.getByRole('button', { name: copy.dispute.action })).toBeDisabled()
    expect(screen.getByText(copy.dispute.cooldownUntil.replace('{time}', '2026-12-04 00:00 UTC'))).toBeInTheDocument()
    const asked = wagmi.readCalls.find(call => call.functionName === 'cooldownEndsAt')
    expect(asked?.args).toEqual([ME, targetId])
  }
  if (situation === 'confirmed danger') {
    action({ tier: 'CONFIRMED_DANGER' })
    expect(screen.queryByRole('button', { name: copy.dispute.action })).toBeNull()
    expect(screen.queryByRole('link', { name: copy.dispute.viewOpen })).toBeNull()
  }
  if (situation === 'modules not live') {
    config.modulesLive = false
    action()
    expect(screen.getByRole('button', { name: copy.dispute.action })).toBeDisabled()
    expect(screen.getByText(copy.common.modulesNotLive)).toBeInTheDocument()
  }
})

test('an elapsed cooldown leaves the button open', () => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  wagmi.reads.current.cooldownEndsAt = unixOf(new Date('2026-11-30T00:00:00.000Z'))
  action()
  expect(screen.getByRole('button', { name: copy.dispute.action })).toBeEnabled()
})

test('without a wallet the panel asks for one instead of reading a cooldown', async () => {
  state.value = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  action()
  expect(wagmi.readCalls.some(call => call.functionName === 'cooldownEndsAt' && call.args?.[0] !== undefined)).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.action }))
  expect(screen.getByText(copy.wallet.connectTitle)).toBeInTheDocument()
})

test('the open challenge is read from the Court, so a challenge opened a moment ago turns the button into a link', () => {
  wagmi.reads.current.activeChallengeOf = 13n
  action({ activeChallengeId: null })
  expect(screen.getByRole('link', { name: copy.dispute.viewOpen })).toHaveAttribute('href', '/app/disputes/13')
  expect(screen.queryByRole('button', { name: copy.dispute.action })).toBeNull()
  const asked = wagmi.readCalls.find(call => call.functionName === 'activeChallengeOf')
  expect(asked?.args).toEqual([targetId])
})

test('a challenge that the Court no longer holds open leaves the button open, whatever the page was loaded with', () => {
  wagmi.reads.current.activeChallengeOf = 0n
  action({ activeChallengeId: '12' })
  expect(screen.getByRole('button', { name: copy.dispute.action })).toBeEnabled()
  expect(screen.queryByRole('link', { name: copy.dispute.viewOpen })).toBeNull()
})

test('until the Court answers, the page says which challenge is open', () => {
  wagmi.reads.current.activeChallengeOf = undefined
  action({ activeChallengeId: '12' })
  expect(screen.getByRole('link', { name: copy.dispute.viewOpen })).toHaveAttribute('href', '/app/disputes/12')
})

test('the panel stays open while the transaction it sent is being confirmed, even once the Court reports the challenge', async () => {
  wagmi.reads.current.activeChallengeOf = 0n
  const view = action()
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.action }))
  expect(screen.getByText(copy.dispute.step[0])).toBeInTheDocument()
  wagmi.reads.current.activeChallengeOf = 13n
  view.rerender(
    <ChallengeAction targetId={targetId} targetType="SMART_CONTRACT" label={address} scan={scan()} tier="CAUTION_FLAGGED" activeChallengeId={null} />,
  )
  expect(screen.getByRole('link', { name: copy.dispute.viewOpen })).toHaveAttribute('href', '/app/disputes/13')
  expect(screen.getByText(copy.dispute.step[0])).toBeInTheDocument()
})

// ---- the panel may be left ------------------------------------------------------------------

test('the panel can be left while the wallet is asking', async () => {
  const closed = vi.fn()
  // A wallet prompt that never settles must not keep the panel on the screen for ever.
  wagmi.signTypedDataAsync.mockReturnValue(new Promise(() => {}))
  render(
    <ChallengePanel targetId={targetId} targetType="SMART_CONTRACT" label={address} scan={scan()} onClose={closed} />,
  )
  await toReview()
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.submit }))
  expect(screen.getByRole('button', { name: copy.common.close })).toBeEnabled()
  document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
  expect(closed).toHaveBeenCalled()
})

test('the panel is locked while the receipt of the transaction is waited for', async () => {
  const closed = vi.fn()
  render(
    <ChallengePanel targetId={targetId} targetType="SMART_CONTRACT" label={address} scan={scan()} onClose={closed} />,
  )
  await toReview()
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.submit }))
  await waitFor(() => expect(screen.getByRole('button', { name: copy.common.close })).toBeDisabled())
  document.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
  expect(closed).not.toHaveBeenCalled()
})

test('the attempt stops when the panel was left, so a late signature pins nothing', async () => {
  // The wallet answers after the panel was closed: the evidence is not pinned and no stake is sent.
  let sign!: (value: string) => void
  wagmi.signTypedDataAsync.mockReturnValue(new Promise((resolve) => { sign = resolve }))
  const closed = vi.fn()
  render(
    <ChallengePanel targetId={targetId} targetType="SMART_CONTRACT" label={address} scan={scan()} onClose={closed} />,
  )
  await toReview()
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.submit }))
  await userEvent.click(screen.getByRole('button', { name: copy.common.close }))
  expect(closed).toHaveBeenCalled()
  await act(async () => { sign(`0x${'11'.repeat(65)}`) })
  expect(uploadEvidence).not.toHaveBeenCalled()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

test('the attempt stops when the panel goes away, so a late signature pins nothing', async () => {
  let sign!: (value: string) => void
  wagmi.signTypedDataAsync.mockReturnValue(new Promise((resolve) => { sign = resolve }))
  const view = render(
    <ChallengePanel targetId={targetId} targetType="SMART_CONTRACT" label={address} scan={scan()} onClose={() => {}} />,
  )
  await toReview()
  await userEvent.click(screen.getByRole('button', { name: copy.dispute.submit }))
  view.unmount()
  await act(async () => { sign(`0x${'11'.repeat(65)}`) })
  expect(uploadEvidence).not.toHaveBeenCalled()
  expect(wagmi.writeContractAsync).not.toHaveBeenCalled()
})

// ---- the cooldown ---------------------------------------------------------------------------

test('the cooldown is judged by the clock of the chain, not by the clock of the browser', () => {
  // The browser runs a year ahead, but the chain says the cooldown is still running.
  vi.useFakeTimers({ now: new Date('2027-01-01T00:00:00.000Z'), toFake: ['Date'] })
  wagmi.reads.current.cooldownEndsAt = unixOf(new Date('2026-12-04T00:00:00.000Z'))
  action()
  expect(screen.getByRole('button', { name: copy.dispute.action })).toBeDisabled()
  expect(screen.getByText(copy.dispute.cooldownUntil.replace('{time}', '2026-12-04 00:00 UTC'))).toBeInTheDocument()
})

test('a cooldown that the chain says is over leaves the button open, whatever the browser says', () => {
  vi.useFakeTimers({ now: new Date('2026-11-01T00:00:00.000Z'), toFake: ['Date'] })
  wagmi.reads.current.cooldownEndsAt = unixOf(new Date('2026-11-30T00:00:00.000Z'))
  wagmi.block.current = { timestamp: BigInt(Math.floor(new Date('2026-12-01T00:00:00.000Z').getTime() / 1000)) }
  action()
  expect(screen.getByRole('button', { name: copy.dispute.action })).toBeEnabled()
})

test('a cooldown that could not be read keeps the button closed', () => {
  wagmi.reads.current.cooldownEndsAt = undefined
  wagmi.readErrors.current.cooldownEndsAt = true
  action()
  expect(screen.getByRole('button', { name: copy.dispute.action })).toBeDisabled()
})

test('the cooldown and the clock of the chain are read again, so the button follows the chain', () => {
  action()
  const cooldown = wagmi.readCalls.find(call => call.functionName === 'cooldownEndsAt')
  expect(cooldown?.refetchInterval).toBeGreaterThan(0)
  expect(wagmi.blockCalls[0]?.refetchInterval).toBeGreaterThan(0)
  expect(wagmi.blockCalls[0]?.chainId).toBe(56)
})
