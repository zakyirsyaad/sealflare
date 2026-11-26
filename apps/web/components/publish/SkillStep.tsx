'use client'
import { useState } from 'react'
import { zeroAddress, type Address, type Hex } from 'viem'
import { canonicalBundleHash, targetIdOfSkill } from '@sealflare/shared/rules'
import { ScanSkillRequest, type ScanReport } from '@sealflare/shared/schemas'
import { Button } from '../ui/Button'
import { api } from '../../lib/api/client'
import { copy } from '../../lib/copy'
import { shortAddress } from '../../lib/format'
import { useBind } from '../../lib/publish/useBind'

export type SkillStepProps = {
  connected: Address | null
  onBound: (targetId: Hex) => void
}

/**
 * The skill branch of the Publish flow. The manifest of the skill names its publisher, and only
 * that wallet may claim it. Another wallet is offered the sponsor role instead.
 */
export function SkillStep({ connected, onBound }: SkillStepProps) {
  const { state, bindSkill, sponsor } = useBind()
  const [repo, setRepo] = useState('')
  const [report, setReport] = useState<ScanReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function scan() {
    // The link is checked with the shared schema before it leaves the browser.
    const parsed = ScanSkillRequest.safeParse({ url: repo.trim() })
    if (!parsed.success) {
      setError(copy.publish.repoInvalid)
      setReport(null)
      return
    }
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      setReport(await api.scanSkill(parsed.data.url))
    } catch {
      setError(copy.publish.scanFailed)
    } finally {
      setBusy(false)
    }
  }

  const source = report?.source.kind === 'skill' ? report.source : null
  const manifest = source?.manifestPublisher ?? null
  const mine = manifest !== null && connected !== null && manifest.toLowerCase() === connected.toLowerCase()
  const named = manifest !== null && manifest.toLowerCase() !== zeroAddress.toLowerCase()
  const targetId = source === null ? null : targetIdOfSkill(source.canonicalBundleHash)
  const contentHash = source === null ? null : canonicalBundleHash(source.contentHash, connected ?? zeroAddress)

  async function claim(): Promise<void> {
    if (source === null) return
    const done = await bindSkill(source.contentHash)
    if (done) onBound(targetIdOfSkill(contentHash ?? source.canonicalBundleHash))
  }

  async function offer(): Promise<void> {
    if (targetId === null) return
    const done = await sponsor(targetId)
    if (done) onBound(targetId)
  }

  return (
    <section className="sf-stack" aria-label={copy.publish.kindSkill}>
      <label className="sf-field">
        <span className="sf-field__label">{copy.publish.repoLabel}</span>
        <input
          className="sf-scan__input mono"
          type="text"
          value={repo}
          onChange={event => setRepo(event.target.value)}
          placeholder={copy.publish.repoHint}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <Button variant="primary" disabled={repo.trim() === '' || busy} onClick={() => void scan()}>
        {copy.publish.scanRepo}
      </Button>
      {error !== null && <p role="alert">{error}</p>}
      {source !== null && (
        <div className="sf-stack">
          <p className="sf-mono">{source.repo}</p>
          {mine && (
            <>
              <p>{copy.publish.manifestMatch}</p>
              <Button variant="primary" disabled={state.status === 'sending'} onClick={() => void claim()}>
                {copy.publish.bindSkill}
              </Button>
            </>
          )}
          {!mine && named && (
            <p>{copy.publish.manifestMismatch.replace('{publisher}', shortAddress(manifest as string))}</p>
          )}
          {!mine && !named && <p>{copy.publish.manifestNone}</p>}
          {!mine && (
            <div className="sf-stack">
              <p>{copy.publish.sponsorExplain}</p>
              <Button disabled={state.status === 'sending'} onClick={() => void offer()}>
                {copy.publish.becomeSponsor}
              </Button>
            </div>
          )}
        </div>
      )}
      {state.error !== null && <p role="alert">{state.error}</p>}
    </section>
  )
}
