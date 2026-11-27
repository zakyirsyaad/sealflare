'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useReadContracts } from 'wagmi'
import type { Address, Hex } from 'viem'
import { coreAbi } from '@sealflare/shared/abi'
import { VERDICTS } from '@sealflare/shared/rules'
import { coreAddress } from '../chain/addresses'
import { expectedChainId } from '../chain/config'

/** How many attestations one call of applyPenalties covers. */
export const PENALTY_CHUNK = 50

/** How many attestations are read at once to find the first one that a page may charge. */
const WINDOW = PENALTY_CHUNK

/** The window of attestations the screen is reading. */
type WindowState = { targetId: string; start: number }

/** The number of the verdict SAFE, as the contract numbers it. */
const SAFE = VERDICTS.indexOf('SAFE')

/**
 * The range of attestations that a page of penalties may charge.
 *
 * The contract charges a range of attestations and it says nothing about which of them still
 * waits for a penalty. The screen reads the attestations of the target itself, so a page starts
 * where the chain says there is still a safe vote to charge, and a page never reaches past the
 * last attestation of the target. The range is read again after every page, so the next page
 * starts where the chain says, not where the last page ended.
 */
export type PenaltyRange = {
  /** The first attestation of the target that a page may charge. Null while it is not known. */
  start: number | null
  /** How many attestations the page covers. */
  size: number
  /** The chain could not be read. */
  failed: boolean
  /** The range is not known yet. */
  loading: boolean
  /** Every attestation of the target is charged already. */
  covered: boolean
  /** Reads the range again. */
  refetch: () => void
}

/** The range of the penalties of one target. */
export function usePenaltyRange(targetId: string, attestationCount: number | null): PenaltyRange {
  const core = coreAddress()
  const [window, setWindow] = useState({ targetId, start: 0 })
  // Another target starts at its own first attestation.
  const start = window.targetId === targetId ? window.start : 0
  const contracts = useMemo(() => rangeContracts(core, targetId, attestationCount, start), [core, targetId, attestationCount, start])
  const read = useReadContracts({
    contracts,
    chainId: expectedChainId,
    query: { enabled: contracts.length > 0 },
  })
  const entries = read.data ?? null
  const first = entries === null ? null : firstChargeable(entries, start)
  const end = attestationCount === null ? 0 : Math.min(attestationCount, start + WINDOW)
  // An attestation that could not be read may still be waiting for a penalty, so the window stays
  // where it is and the failure is shown instead of a page that may charge the wrong votes.
  const failed = read.isError === true || (entries ?? []).some(entry => failedOf(entry))
  useAdvance(first, entries, attestationCount, end, targetId, setWindow, failed)
  const { refreshing, refetch } = useRangeRead(read)
  const empty = attestationCount === 0
  return {
    start: first,
    size: first === null || attestationCount === null ? 0 : Math.min(PENALTY_CHUNK, attestationCount - first),
    failed,
    loading: (entries === null && !empty) || refreshing,
    covered: empty || (entries !== null && first === null && !failed && attestationCount !== null && end >= attestationCount),
    refetch,
  }
}

/** The reads of the attestations of a window of the target. */
function rangeContracts(
  core: Address | null,
  targetId: string,
  attestationCount: number | null,
  start: number,
): { abi: typeof coreAbi; address: Address; functionName: 'getAttestation'; args: [Hex, number] }[] {
  if (core === null || attestationCount === null || attestationCount <= 0) return []
  const end = Math.min(attestationCount, start + WINDOW)
  const list: { abi: typeof coreAbi; address: Address; functionName: 'getAttestation'; args: [Hex, number] }[] = []
  for (let index = start; index < end; index += 1) {
    list.push({ abi: coreAbi, address: core, functionName: 'getAttestation', args: [targetId as Hex, index] })
  }
  return list
}

/**
 * Reads the next window of the target when the window holds nothing to charge.
 *
 * A window of attestations that are charged already is not read again and again: the screen moves
 * on to the next window, and the first attestation it finds that the chain still charges is the
 * one the next page starts at. A window that could not be read is not moved past, because an
 * attestation that was never read may still be waiting for a penalty.
 */
function useAdvance(
  first: number | null,
  entries: unknown[] | null,
  attestationCount: number | null,
  end: number,
  targetId: string,
  setWindow: Dispatch<SetStateAction<WindowState>>,
  failed: boolean,
): void {
  useEffect(() => {
    if (entries === null || first !== null) return
    if (attestationCount === null) return
    // A window that could not be read is not moved past, so the retry is offered.
    if (failed) return
    // The whole target has been read, so there is nothing left to charge.
    if (end >= attestationCount) return
    setWindow(current => (current.targetId === targetId && current.start === end ? current : { targetId, start: end }))
  }, [entries, first, attestationCount, end, targetId, setWindow, failed])
}

/**
 * Reads the range again, and says whether the answer is still on its way.
 *
 * A range that is read again is not known until the chain answers, so the page waits for it. The
 * reader never sends a page that starts where the last page ended.
 */
function useRangeRead(read: { refetch: () => unknown; dataUpdatedAt?: number; isError?: boolean }): {
  refreshing: boolean
  refetch: () => void
} {
  const [refreshing, setRefreshing] = useState(false)
  const seen = useRef(read.dataUpdatedAt ?? 0)
  const latest = useRef(read.refetch)
  latest.current = read.refetch
  useEffect(() => {
    const at = read.dataUpdatedAt ?? 0
    if (at !== seen.current) {
      seen.current = at
      setRefreshing(false)
    }
    // A read that failed is not on its way any more.
    if (read.isError === true) setRefreshing(false)
  }, [read.dataUpdatedAt, read.isError])
  const refetch = useCallback(() => {
    setRefreshing(true)
    void latest.current()
  }, [])
  return { refreshing, refetch }
}

/**
 * The first attestation of the window that the chain still charges.
 *
 * The contract charges a safe vote that was not charged yet, so a safe vote that was charged
 * already is not a page that is worth the gas.
 */
function firstChargeable(entries: readonly unknown[], start: number): number | null {
  for (let index = 0; index < entries.length; index += 1) {
    if (chargeableOf(entries[index])) return start + index
  }
  return null
}

/** Whether one attestation of the batch is still waiting for a penalty. */
function chargeableOf(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false
  const value = entry as { status?: unknown; result?: unknown }
  if (value.status !== 'success') return false
  if (typeof value.result !== 'object' || value.result === null) return false
  const attestation = value.result as { verdict?: unknown; penalized?: unknown }
  return attestation.verdict === SAFE && attestation.penalized === false
}

/** Whether one read of the batch failed. */
function failedOf(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false
  return (entry as { status?: unknown }).status === 'failure'
}
