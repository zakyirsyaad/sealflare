import 'server-only'
import { z } from 'zod'
import { AttestationRow, ResponseMeta } from '@sealflare/shared/schemas'
import type { EvidenceRow } from './chain'

/**
 * The evidence of a target, read from the internal service.
 *
 * The indexer stores the Attested events of the finalized blocks, so the evidence of a target of
 * any age comes from the database. Reading it from the event log of a public RPC instead costs
 * one call per range of blocks between the creation of the target and the head, and a cold
 * instance pays that again for every target it shows.
 */

/** How long the page waits for the internal service. */
const TIMEOUT_MS = 5_000

/** How many votes one page of the internal service holds. */
const PAGE_SIZE = 100

/** The internal service is only reached when it is configured. */
const InternalEnv = z.object({
  INTERNAL_URL: z.url().refine(value => /^https?:\/\//.test(value), 'Use an HTTP or HTTPS URL'),
  INTERNAL_KEY: z.string().trim().min(1),
})

/** The rows of the internal service, with the block they were read at. */
export type IndexedEvidence = {
  rows: EvidenceRow[]
  /** The last final block the indexer has read. The votes above it are not in the database yet. */
  finalizedBlock: bigint
}

/** The answer of the internal service, with the meta that names the block it was read at. */
const Answer = z.object({
  success: z.literal(true),
  data: z.object({ items: z.array(AttestationRow) }),
  meta: ResponseMeta,
})

/** The internal service sends the votes of the frozen read model, and only their evidence is used. */
function toRows(items: readonly AttestationRow[]): EvidenceRow[] {
  return items.map(item => ({
    index: item.index,
    shortProof: item.shortProof,
    evidenceURI: item.evidenceURI,
    txHash: item.txHash,
  }))
}

/** One page of the votes of a target. Null when the service cannot answer it. */
async function fetchPage(url: string, key: string, targetId: string, page: number): Promise<z.infer<typeof Answer> | null> {
  const base = url.replace(/\/$/, '')
  let response: Response
  try {
    response = await fetch(`${base}/targets/${targetId}/attestations?page=${page}&limit=${PAGE_SIZE}`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  const parsed = Answer.safeParse(body)
  return parsed.success ? parsed.data : null
}

/**
 * The evidence of a target, as the indexer stored it.
 *
 * Null when the internal service is not configured, cannot be reached, or does not know the
 * target: the caller then reads the event log from the chain instead.
 */
export async function readIndexedEvidence(targetId: string): Promise<IndexedEvidence | null> {
  const env = InternalEnv.safeParse({
    INTERNAL_URL: process.env.INTERNAL_URL,
    INTERNAL_KEY: process.env.INTERNAL_KEY,
  })
  if (!env.success) return null
  const rows: EvidenceRow[] = []
  let finalizedBlock: bigint | null = null
  let page = 1
  for (;;) {
    const answer = await fetchPage(env.data.INTERNAL_URL, env.data.INTERNAL_KEY, targetId, page)
    if (answer === null) return null
    rows.push(...toRows(answer.data.items))
    const block = answer.meta.finalizedBlock
    if (block !== undefined) finalizedBlock = BigInt(block)
    const meta = answer.meta.page
    // The service names how many votes it has, so the pages are read until they are all there.
    if (meta === undefined || rows.length >= meta.total) break
    page += 1
  }
  if (finalizedBlock === null) return null
  return { rows, finalizedBlock }
}
