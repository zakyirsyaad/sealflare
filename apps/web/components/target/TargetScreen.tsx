import type { AttestationRow, ScanReport, TargetDetail } from '@sealflare/shared/schemas'
import { ActionColumn } from './ActionColumn'
import { Banners } from './Banners'
import { Identity } from './Identity'
import { StaleNotice } from './StaleNotice'
import { StatusCard } from './StatusCard'
import { TargetError } from './TargetError'
import { TargetMissing } from './TargetMissing'
import { TargetTabs } from './TargetTabs'
import { copy } from '../../lib/copy'
import { scanCurrentVersionHref } from '../../lib/currentVersion'
import { shortAddress } from '../../lib/format'

export type TargetScreenProps = {
  targetId: string
  detail: TargetDetail | null
  attestations: AttestationRow[]
  scan: ScanReport | null
  src: string | null
  blocksBehind: number | null
  unbondingAt: number | null
  versionChanged: boolean
  currentVersionId: string | null
  differentBundle: boolean
  evidenceFailed: boolean
  failed: boolean
}

/** The link names another bundle than the one the registry rated. */
function ForeignNotice() {
  return (
    <div className="sf-version">
      <p>{copy.target.differentBundle}</p>
    </div>
  )
}

function VersionNotice({ targetId, src }: { targetId: string; src: string | null }) {
  return (
    <div className="sf-version">
      <p>{copy.target.modifiedText}</p>
      <a className="sf-btn sf-btn--primary" href={`/app/t/${targetId}?src=${encodeURIComponent(src ?? '')}`}>
        {copy.target.currentVersion}
      </a>
    </div>
  )
}

/** The target page: the identity, the warnings, the status, the actions and the details. */
export function TargetScreen(props: TargetScreenProps) {
  const { detail } = props
  if (props.failed) return <TargetError />
  if (detail === null) return <TargetMissing src={props.src} />
  const isContract = detail.targetType === 'SMART_CONTRACT'
  const label = isContract ? shortAddress(detail.label) : detail.label
  const repo = props.scan?.source.kind === 'skill' ? props.scan.source.repo : null
  return (
    <div className="sf-target">
      <Identity
        label={label}
        targetType={detail.targetType}
        address={isContract ? detail.label : null}
        repo={repo}
        hash={detail.pinnedCodehash === `0x${'0'.repeat(64)}` ? null : detail.pinnedCodehash}
        version={props.scan?.source.kind === 'skill' ? props.scan.source.commit : null}
      />
      {props.versionChanged && props.currentVersionId !== null && <VersionNotice targetId={props.currentVersionId} src={props.src} />}
      {props.differentBundle && <ForeignNotice />}
      <Banners detail={detail} scan={props.scan} unbondingAt={props.unbondingAt} />
      <StaleNotice blocksBehind={props.blocksBehind} />
      <div className="sf-target__body">
        <StatusCard detail={detail} />
        <ActionColumn tier={detail.tier} targetType={detail.targetType} currentVersionHref={scanCurrentVersionHref(detail.src)} />
      </div>
      <section className="sf-frame sf-target__tabs">
        <TargetTabs detail={detail} rows={props.attestations} scan={props.scan} evidenceFailed={props.evidenceFailed} />
      </section>
    </div>
  )
}
