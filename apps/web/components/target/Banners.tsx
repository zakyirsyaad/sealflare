import type { ScanReport, TargetDetail } from '@sealflare/shared/schemas'
import { Banner } from '../ui/Banner'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'

export type BannersProps = {
  detail: TargetDetail
  scan: ScanReport | null
  unbondingAt: number | null
}

/** The scan found a proxy, but the on-chain marker is not set yet. */
function isProxy(scan: ScanReport | null): boolean {
  return scan?.source.kind === 'contract' && scan.source.implementation !== undefined
}

/**
 * The warning strips above the status. They cannot be closed: each of them states a fact of the
 * chain that the visitor has to see.
 */
export function Banners({ detail, scan, unbondingAt }: BannersProps) {
  const proxy = isProxy(scan)
  return (
    <div className="sf-banners">
      {detail.tier === 'CONFIRMED_DANGER' && (
        <Banner tone="danger">
          <div>
            <div className="sf-banner__title">{copy.target.confirmedDanger}</div>
            <div className="sf-banner__text">{copy.target.dangerText}</div>
          </div>
        </Banner>
      )}
      {detail.tier === 'STALE_CODEHASH_DRIFT' && (
        <Banner tone="warning">
          <div>
            <div className="sf-banner__title">{copy.target.modified}</div>
            <div className="sf-banner__text">{copy.target.modifiedText}</div>
          </div>
        </Banner>
      )}
      {detail.activeChallengeId !== null && (
        <Banner tone="warning">
          <div>
            <div className="sf-banner__title">{copy.target.underDispute}</div>
            <div className="sf-banner__text">
              {copy.target.disputeText} {copy.target.challengeOpen.replace('{id}', detail.activeChallengeId)}
            </div>
          </div>
        </Banner>
      )}
      {unbondingAt !== null && (
        <Banner tone="info">
          <div>
            <div className="sf-banner__title">{copy.target.unbonding}</div>
            <div className="sf-banner__text">
              {copy.target.unbondingText.replace('{date}', new Date(unbondingAt * 1000).toISOString().slice(0, 10))}
            </div>
          </div>
        </Banner>
      )}
      {proxy && (
        <Banner tone="warning">
          <div>
            <div className="sf-banner__title">{copy.target.proxyTitle}</div>
            <div className="sf-banner__text">{copy.target.proxyText}</div>
            {!detail.hasDelegatecall && (
              <div className="sf-banners__action">
                <Button variant="secondary" disabled>
                  {copy.target.flagProxy}
                </Button>
                <span className="sf-banner__text">{copy.target.proxyFlagNote}</span>
              </div>
            )}
          </div>
        </Banner>
      )}
    </div>
  )
}
