import { copy } from '../../lib/copy'

export type TargetMissingProps = { src: string | null }

/**
 * The registry has no record of this target. With a source the visitor can scan it again,
 * without one the cached result is simply gone.
 */
export function TargetMissing({ src }: TargetMissingProps) {
  return (
    <div className="sf-target sf-target--missing">
      <h1>{copy.scan.expired}</h1>
      {src !== null && (
        <a className="sf-btn sf-btn--primary" href={`/app?q=${encodeURIComponent(src)}`}>
          {copy.scan.again}
        </a>
      )}
    </div>
  )
}
