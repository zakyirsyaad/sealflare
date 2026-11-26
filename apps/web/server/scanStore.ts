import 'server-only'
import type { ScanReport } from '@sealflare/shared/schemas'

/**
 * The scan result of the last few minutes, kept per target so the target page can show the
 * findings of the scan that the visitor just ran. The indexer of a later task replaces this
 * store with a durable one; until then a restart simply means "not scanned yet".
 */
const TTL_MS = 10 * 60 * 1000

type Entry = { report: ScanReport; storedAt: number }

const entries = new Map<string, Entry>()
const bySource = new Map<string, Entry>()

function key(targetId: string): string {
  return targetId.toLowerCase()
}

export function putScan(report: ScanReport, now: number = Date.now()): void {
  entries.set(key(report.targetId), { report, storedAt: now })
}

export function getScan(targetId: string, now: number = Date.now()): ScanReport | null {
  const entry = entries.get(key(targetId))
  if (!entry) return null
  if (now - entry.storedAt > TTL_MS) {
    entries.delete(key(targetId))
    return null
  }
  return entry.report
}

/**
 * The scan of a `?src=` value, kept apart from the per-target store. A source that names another
 * version of a skill answers under another id, and without this it would be scanned again, and paid
 * for again, on every request.
 */
export function putScanForSource(src: string, report: ScanReport, now: number = Date.now()): void {
  bySource.set(src, { report, storedAt: now })
}

export function getScanForSource(src: string, now: number = Date.now()): ScanReport | null {
  const entry = bySource.get(src)
  if (!entry) return null
  if (now - entry.storedAt > TTL_MS) {
    bySource.delete(src)
    return null
  }
  return entry.report
}

/** Only used by the tests, so a run never sees the report of another run. */
export function clearScans(): void {
  entries.clear()
  bySource.clear()
}
