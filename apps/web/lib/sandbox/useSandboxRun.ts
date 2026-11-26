'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSignTypedData } from 'wagmi'
import { API_EIP712 } from '@sealflare/shared/schemas'
import { api, ApiError, type RunState } from '../api/client'
import { expectedChainId } from '../chain/config'
import { isUserRejection } from '../chain/errors'
import { copy } from '../copy'

/** How often the state of a run is read while it is not finished. */
const POLL_MS = 2_000

/** How long a signed request lives. */
const EXPIRY_SECONDS = 300

export type SandboxRunInput = { bundleHash: `0x${string}`; src: string; address: `0x${string}` }

export type UseSandboxRun = {
  /** The state of the run, or null when no run was started. */
  run: RunState | null
  /** The run is being started or read. */
  busy: boolean
  /** The reason the last attempt failed, or null. */
  error: string | null
  /** The reason the sandbox is paused for today, or null. */
  paused: boolean
  start: (input: SandboxRunInput) => Promise<void>
}

/** A nonce nobody else can guess, as the decimal string the API reads. */
function newNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return BigInt(`0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`).toString()
}

/**
 * The run of a sandbox, and the polling that follows it.
 *
 * The signature is asked for once, when the run is started. Nothing is signed again while the run
 * is read, so a visitor is never asked to sign twice for one run.
 */
export function useSandboxRun(): UseSandboxRun {
  const { signTypedDataAsync } = useSignTypedData()
  const [run, setRun] = useState<RunState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A read that is still on its way when the page is left must not arm the next one.
  const alive = useRef(true)

  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      stop()
    }
  }, [stop])

  /** Reads the state of the run and asks for the next read when it is not finished. */
  const follow = useCallback(
    (runId: string) => {
      stop()
      timer.current = setTimeout(() => {
        void api
          .sandboxRunStatus(runId)
          .then(state => {
            if (!alive.current) return
            setRun(state)
            if (state.status === 'queued' || state.status === 'running') follow(runId)
          })
          .catch(() => {
            if (alive.current) setError('The sandbox run could not be read.')
          })
      }, POLL_MS)
    },
    [stop],
  )

  const start = useCallback(
    async (input: SandboxRunInput) => {
      setBusy(true)
      setError(null)
      setPaused(false)
      try {
        const nonce = newNonce()
        const expiry = String(Math.floor(Date.now() / 1000) + EXPIRY_SECONDS)
        const signature = await signTypedDataAsync({
          domain: { ...API_EIP712.domain, chainId: expectedChainId },
          types: { SandboxRun: [...API_EIP712.types.SandboxRun] },
          primaryType: 'SandboxRun',
          message: { bundleHash: input.bundleHash, nonce: BigInt(nonce), expiry: BigInt(expiry) },
        })
        const created = await api.sandboxRun({
          bundleHash: input.bundleHash,
          src: input.src,
          address: input.address,
          nonce,
          expiry,
          signature,
        })
        if (!alive.current) return
        setRun({ runId: created.runId, status: 'queued', queuePosition: created.queuePosition })
        follow(created.runId)
      } catch (caught) {
        if (!alive.current) return
        if (caught instanceof ApiError && caught.code === 'SANDBOX_PAUSED') {
          setPaused(true)
        } else if (!isUserRejection(caught)) {
          // Only the text of the API is shown. The text of a wallet or a network error is not ours.
          setError(caught instanceof ApiError ? caught.message : copy.errors.unknown)
        }
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [follow, signTypedDataAsync],
  )

  return { run, busy, error, paused, start }
}
