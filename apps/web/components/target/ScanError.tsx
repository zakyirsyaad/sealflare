'use client'
import { CONSTANTS } from '@sealflare/shared/rules'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import type { ApiError } from '../../lib/api/client'

const MESSAGES: Record<string, string> = {
  INPUT_NOT_RECOGNIZED: copy.scan.invalidInput,
  NO_CODE_AT_ADDRESS: copy.scan.noContract,
  REPO_NOT_PUBLIC: copy.scan.privateRepo,
  NO_SKILL_FOUND: copy.scan.noSkill,
  BUNDLE_TOO_LARGE: copy.scan.tooLarge,
  RPC_UNAVAILABLE: copy.scan.rpcUnavailable,
  RESULT_NOT_CACHED: copy.scan.expired,
}

const mebibytes = Number((CONSTANTS.MAX_BUNDLE_BYTES / 1_048_576).toFixed(1))

// The next step ux.md 6.6 names for each error.
const HINTS: Record<string, string> = {
  INPUT_NOT_RECOGNIZED: copy.scan.hintInput,
  NO_CODE_AT_ADDRESS: copy.scan.hintNoContract,
  REPO_NOT_PUBLIC: copy.scan.hintPrivateRepo,
  NO_SKILL_FOUND: copy.scan.hintNoSkill,
  BUNDLE_TOO_LARGE: copy.scan.tooLargeLimit.replace('{size}', String(mebibytes)).replace('{files}', String(CONSTANTS.MAX_BUNDLE_FILES)),
}

export type ScanErrorDetails = { folders?: string[]; retryAfterSeconds?: number }

function detailsOf(error: ApiError): ScanErrorDetails {
  const details = error.details
  return typeof details === 'object' && details !== null ? (details as ScanErrorDetails) : {}
}

function messageOf(error: ApiError): string {
  if (error.code === 'RATE_LIMITED') {
    const seconds = detailsOf(error).retryAfterSeconds
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return copy.scan.rateLimitUnknown
    const minutes = Math.ceil(seconds / 60)
    return minutes === 1 ? copy.scan.rateLimitOne : copy.scan.rateLimit.replace('{minutes}', String(minutes))
  }
  return MESSAGES[error.code] ?? error.message
}

export type ScanErrorProps = {
  error: ApiError
  onChooseFolder?: (folder: string) => void
  /** Runs the same scan again. Offered only when the chain could not be reached. */
  onRetry?: () => void
}

/** Every scan error of docs/ux.md 6.6, in the words the specification uses. */
export function ScanError({ error, onChooseFolder, onRetry }: ScanErrorProps) {
  const folders = detailsOf(error).folders ?? []
  const hint = HINTS[error.code]
  return (
    <Banner tone="danger">
      <div>
        <p className="sf-banner__title">{messageOf(error)}</p>
        {hint && <p className="sf-banner__text">{hint}</p>}
        {error.code === 'RPC_UNAVAILABLE' && onRetry && (
          <Button variant="secondary" onClick={onRetry}>{copy.common.retry}</Button>
        )}
        {folders.length > 0 && (
          <>
            <p className="sf-banner__text">{copy.scan.folders}</p>
            <ul className="sf-connectors" aria-label={copy.scan.folders}>
              {folders.map(folder => (
                <li key={folder}>
                  <button type="button" className="sf-btn sf-btn--secondary" onClick={() => onChooseFolder?.(folder)}>
                    {folder}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Banner>
  )
}
