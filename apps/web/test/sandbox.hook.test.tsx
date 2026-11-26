import { renderHook, act } from '@testing-library/react'
import { UserRejectedRequestError } from 'viem'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { SandboxRunCreateRequest } from '@sealflare/shared/schemas'

const wagmi = vi.hoisted(() => ({ sign: vi.fn() }))
vi.mock('wagmi', () => ({ useSignTypedData: () => ({ signTypedDataAsync: wagmi.sign }) }))

vi.mock('../lib/chain/config', () => ({
  get expectedChainId() {
    return 56
  },
}))

const api = vi.hoisted(() => ({ sandboxRun: vi.fn(), sandboxRunStatus: vi.fn() }))
vi.mock('../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/client')>('../lib/api/client')
  return { ...actual, api }
})

import { ApiError } from '../lib/api/client'
import { copy } from '../lib/copy'
import { useSandboxRun } from '../lib/sandbox/useSandboxRun'

const INPUT = {
  bundleHash: `0x${'ab'.repeat(32)}` as const,
  src: `gh:sealflare/demo@${'a'.repeat(40)}:skills/demo`,
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const,
}
const CREATED = { runId: `run_${'12'.repeat(12)}`, status: 'queued', queuePosition: 1, quotaLeft: 4 }

beforeEach(() => {
  vi.clearAllMocks()
  wagmi.sign.mockResolvedValue(`0x${'11'.repeat(65)}`)
  api.sandboxRun.mockResolvedValue(CREATED)
  api.sandboxRunStatus.mockResolvedValue({ runId: CREATED.runId, status: 'queued', queuePosition: 1 })
})

afterEach(() => {
  vi.useRealTimers()
})

test('the request the browser sends is a request the public API accepts', async () => {
  const { result } = renderHook(() => useSandboxRun())
  await act(() => result.current.start(INPUT))
  const body = api.sandboxRun.mock.calls[0]?.[0]
  const parsed = SandboxRunCreateRequest.safeParse(body)
  expect(parsed.success).toBe(true)
  const signed = wagmi.sign.mock.calls[0]?.[0] as { message: { nonce: bigint } }
  expect(signed.message.nonce).toBe(BigInt((body as { nonce: string }).nonce))
})

test('a refusal in the wallet shows no error and queues nothing', async () => {
  wagmi.sign.mockRejectedValue(new UserRejectedRequestError(new Error('rejected')))
  const { result } = renderHook(() => useSandboxRun())
  await act(() => result.current.start(INPUT))
  expect(result.current.error).toBeNull()
  expect(api.sandboxRun).not.toHaveBeenCalled()
})

test('an error that does not come from the API shows a plain message, never its own text', async () => {
  wagmi.sign.mockRejectedValue(new Error('Details: request to https://rpc.example/secret failed'))
  const { result } = renderHook(() => useSandboxRun())
  await act(() => result.current.start(INPUT))
  expect(result.current.error).toBe(copy.errors.unknown)
})

test('a refusal of the API keeps its own message', async () => {
  api.sandboxRun.mockRejectedValue(new ApiError('QUOTA_EXHAUSTED', 'You have used all 5 sandbox runs for today.'))
  const { result } = renderHook(() => useSandboxRun())
  await act(() => result.current.start(INPUT))
  expect(result.current.error).toBe('You have used all 5 sandbox runs for today.')
})

test('a read that is still on its way when the page is left does not start the polling again', async () => {
  vi.useFakeTimers()
  let release: (value: unknown) => void = () => {}
  api.sandboxRunStatus.mockImplementation(() => new Promise(resolve => (release = resolve)))
  const { result, unmount } = renderHook(() => useSandboxRun())
  await act(() => result.current.start(INPUT))
  await act(() => vi.advanceTimersByTimeAsync(2_000))
  expect(api.sandboxRunStatus).toHaveBeenCalledTimes(1)
  unmount()
  await act(async () => {
    release({ runId: CREATED.runId, status: 'queued', queuePosition: 1 })
    await vi.advanceTimersByTimeAsync(10_000)
  })
  expect(api.sandboxRunStatus).toHaveBeenCalledTimes(1)
})
