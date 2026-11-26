import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { SandboxResult } from '@sealflare/shared/schemas'
import noViolation from '@sealflare/shared/fixtures/sandbox/no-violation.json'
import fuzzFailed from '@sealflare/shared/fixtures/sandbox/fuzz-failed.json'
import incomplete from '@sealflare/shared/fixtures/sandbox/incomplete.json'
import { SandboxSection } from '../components/target/SandboxSection'
import { copy } from '../lib/copy'

const user = vi.hoisted(() => ({ value: { kind: 'holder', address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', attestationsLeft: 5, isLoading: false, recheck: () => {} } as Record<string, unknown> }))
vi.mock('../lib/chain/userState', () => ({ useUserState: () => user.value }))

const hook = vi.hoisted(() => ({ value: { run: null, busy: false, error: null, paused: false, start: vi.fn() } as Record<string, unknown> }))
vi.mock('../lib/sandbox/useSandboxRun', () => ({ useSandboxRun: () => hook.value }))

const ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const BUNDLE = `0x${'ab'.repeat(32)}`
const SRC = `gh:sealflare/demo@${'a'.repeat(40)}:skills/demo`

function fixture(value: unknown): SandboxResult {
  return value as SandboxResult
}

/** The quota the service reports for the address. */
function stubQuota(left = 4) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            success: true,
            data: { left, limit: 5, resetsAt: '2026-11-27T00:00:00.000Z' },
          }),
      } as Response),
    ),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
  user.value = { kind: 'holder', address: ADDRESS, attestationsLeft: 5, isLoading: false, recheck: () => {} }
  hook.value = { run: null, busy: false, error: null, paused: false, start: vi.fn() }
})

test('a queued run shows its position in the queue', () => {
  stubQuota()
  hook.value = { ...hook.value, run: { runId: 'run_1', status: 'queued', queuePosition: 2 } }
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={null} />)
  expect(screen.getByText('Position 2 in the queue.')).toBeVisible()
})

test('a running run shows the probe in progress', () => {
  stubQuota()
  hook.value = {
    ...hook.value,
    run: { runId: 'run_1', status: 'running', currentProbe: 'indirect_injection' },
  }
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={null} />)
  expect(screen.getByText('Running probe: indirect injection.')).toBeVisible()
})

test('a running run with no probe yet says the probe set is running', () => {
  stubQuota()
  hook.value = { ...hook.value, run: { runId: 'run_1', status: 'running' } }
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={null} />)
  expect(screen.getByText('Running the probe set.')).toBeVisible()
})

test('a clean result says no violation was observed, with the model and the date', () => {
  stubQuota()
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={fixture(noViolation)} />)
  expect(screen.getByText('No violation observed')).toBeVisible()
  expect(screen.getByText('Model claude-haiku-5-5, run on 2026-11-22 03:02 UTC.')).toBeVisible()
  expect(screen.getByText('This is not proof that the skill is safe.')).toBeVisible()
})

test('a result with a violation shows the caught tool calls per probe', () => {
  stubQuota()
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={fixture(fuzzFailed)} />)
  expect(screen.getByText('Caught tool calls')).toBeVisible()
  expect(screen.getByText('Approval escalation')).toBeVisible()
  expect(screen.getByText('approve broke the rule UNLIMITED_APPROVAL.')).toBeVisible()
})

test('an incomplete result shows the partial results and the reason', () => {
  stubQuota()
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={fixture(incomplete)} />)
  expect(screen.getByText('The run stopped early: The model provider stopped answering.')).toBeVisible()
  expect(screen.getByText('This is not proof that the skill is safe.')).toBeVisible()
})

test('a paused sandbox says so and leaves the layer 1 results alone', () => {
  stubQuota()
  hook.value = { ...hook.value, paused: true }
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={null} />)
  expect(screen.getByText('Sandbox is paused for today. Layer 1 results are unaffected.')).toBeVisible()
})

test('the Run sandbox button states the cost of one run', () => {
  stubQuota()
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={null} />)
  expect(screen.getByRole('button', { name: 'Run sandbox' })).toBeVisible()
  expect(screen.getByText(copy.sandbox.cost)).toBeVisible()
})

test('the runs that are left today are shown next to the button', async () => {
  stubQuota(3)
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={null} />)
  expect(await screen.findByText('3 of 5 daily runs left today')).toBeVisible()
})

test('a bundle that was already run shows its result and offers no button', () => {
  stubQuota()
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={fixture(noViolation)} />)
  expect(screen.getByText('No violation observed')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Run sandbox' })).toBeNull()
})

test('a contract is not sandboxed, so the section says so and offers no button', () => {
  stubQuota()
  render(<SandboxSection targetType="SMART_CONTRACT" src={null} bundleHash={null} sandbox={null} />)
  expect(screen.getByText('The sandbox tests AI skills. It does not apply to contracts.')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Run sandbox' })).toBeNull()
})

test('without a wallet the button is closed with a reason', () => {
  stubQuota()
  user.value = { kind: 'no-wallet', isLoading: false, isError: false, recheck: () => {} }
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={null} />)
  expect(screen.getByRole('button', { name: 'Run sandbox' })).toBeDisabled()
  expect(screen.getByText('Connect a wallet to run the sandbox.')).toBeVisible()
})

test('a skill that was never scanned has no bundle to run', () => {
  stubQuota()
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={null} bundleHash={null} sandbox={null} />)
  expect(screen.getByRole('button', { name: 'Run sandbox' })).toBeDisabled()
  expect(screen.getByText('This skill has not been scanned yet, so there is nothing to run.')).toBeVisible()
})

test('the daily limit closes the button and says so', async () => {
  stubQuota(0)
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={null} />)
  expect(await screen.findByText('You have used all 5 sandbox runs for today.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Run sandbox' })).toBeDisabled()
})

test('a violation that repeats in every run of a probe is listed once', () => {
  stubQuota()
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const repeated = structuredClone(fixture(fuzzFailed))
  const probe = repeated.probes.find(item => item.runs.some(run => run.violations.length > 0))!
  const violation = probe.runs.find(run => run.violations.length > 0)!.violations[0]!
  for (const run of probe.runs) {
    run.outcome = 'violation'
    run.violations = [violation]
  }
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={repeated} />)
  const line = copy.sandbox.call.replace('{tool}', violation.tool).replace('{rule}', violation.rule)
  expect(screen.getAllByText(line)).toHaveLength(1)
  expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/)
  errors.mockRestore()
})

test('the state of a run is announced to a screen reader', () => {
  stubQuota()
  hook.value = { ...hook.value, run: { runId: 'run_1', status: 'queued', queuePosition: 2 } }
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={null} />)
  expect(screen.getByRole('status')).toHaveTextContent('Position 2 in the queue.')
})

test('a failed start is announced as an alert', () => {
  stubQuota()
  hook.value = { ...hook.value, error: 'You have used all 5 sandbox runs for today.' }
  render(<SandboxSection targetType="AI_SKILL_BUNDLE" src={SRC} bundleHash={BUNDLE} sandbox={null} />)
  expect(screen.getByRole('alert')).toHaveTextContent('You have used all 5 sandbox runs for today.')
})
