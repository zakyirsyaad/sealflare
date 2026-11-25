'use client'
import { useState } from 'react'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { shortAddress } from '../../lib/format'

export type IdentityProps = {
  label: string
  targetType: 'SMART_CONTRACT' | 'AI_SKILL_BUNDLE'
  address: string | null
  repo: string | null
  /** The pinned hash: the code hash of a contract, the bundle hash of a skill. */
  hash: string | null
  /** The version that was rated, for a skill. */
  version: string | null
}

/** The address or the repository, the kind of target and the way out to the explorer. */
export function Identity({ label, targetType, address, repo, hash, version }: IdentityProps) {
  const [copied, setCopied] = useState(false)
  const value = address ?? repo ?? label
  function onCopy() {
    void Promise.resolve(navigator.clipboard?.writeText(value)).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }
  return (
    <div className="sf-identity">
      <h1 className="sf-mono sf-identity__label">{label}</h1>
      <span className="sf-chip">{targetType === 'SMART_CONTRACT' ? copy.target.contract : copy.target.skill}</span>
      <span className="sf-chip">{copy.target.chain}</span>
      {hash !== null && <span className="sf-chip sf-mono">{shortAddress(hash)}</span>}
      {version !== null && <span className="sf-chip sf-mono">{version.slice(0, 7)}</span>}
      <span className="sf-identity__spacer" />
      <Button variant="ghost" onClick={onCopy}>
        {copied ? copy.target.copied : targetType === 'SMART_CONTRACT' ? copy.target.copyAddress : copy.target.copyLink}
      </Button>
      {address !== null && (
        <a className="sf-btn sf-btn--ghost" href={`https://bscscan.com/address/${address}`} target="_blank" rel="noreferrer">
          {copy.target.viewOnBscScan}
        </a>
      )}
      {repo !== null && (
        <a className="sf-btn sf-btn--ghost" href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">
          {copy.target.viewRepository}
        </a>
      )}
    </div>
  )
}
