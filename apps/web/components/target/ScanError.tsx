'use client'
import { Banner } from '../ui/Banner'
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

export type ScanErrorDetails = { folders?: string[]; retryAfterSeconds?: number }

function detailsOf(error: ApiError): ScanErrorDetails {
  const details = error.details
  return typeof details === 'object' && details !== null ? (details as ScanErrorDetails) : {}
}

function messageOf(error: ApiError): string {
  if (error.code === 'RATE_LIMITED') {
    const seconds = detailsOf(error).retryAfterSeconds ?? 60
    const minutes = Math.max(1, Math.ceil(seconds / 60))
    return copy.scan.rateLimit.replace('{minutes}', String(minutes))
  }
  return MESSAGES[error.code] ?? error.message
}

export type ScanErrorProps = {
  error: ApiError
  onChooseFolder?: (folder: string) => void
}

/** Every scan error of docs/ux.md 6.6, in the words the specification uses. */
export function ScanError({ error, onChooseFolder }: ScanErrorProps) {
  const folders = detailsOf(error).folders ?? []
  return (
    <Banner tone="danger">
      <div>
        <p className="sf-banner__title">{messageOf(error)}</p>
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
