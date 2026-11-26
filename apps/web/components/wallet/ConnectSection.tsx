'use client'
import { useConnect, useConnectors } from 'wagmi'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'

export type ConnectSectionProps = {
  /** Why the wallet is needed. */
  what?: string
}

/**
 * The wallet has to be connected before anything can be signed.
 *
 * A connection that fails is named, so the reader knows that the wallet is the reason and not
 * the page.
 */
export function ConnectSection({ what = copy.wallet.connectIntro }: ConnectSectionProps) {
  const connectors = useConnectors()
  const { mutate, isPending, error } = useConnect()
  return (
    <section className="sf-stack">
      <h3 className="sf-stack__title">{copy.wallet.connectTitle}</h3>
      <p className="sf-lead">{what}</p>
      <ul className="sf-connectors">
        {connectors.map(connector => (
          <li key={connector.uid}>
            <Button className="sf-btn--block" disabled={isPending} onClick={() => mutate({ connector })}>
              {connector.name}
            </Button>
          </li>
        ))}
      </ul>
      {error !== null && error !== undefined && (
        <p role="alert" className="sf-error">
          {copy.wallet.connectFailed}
        </p>
      )}
    </section>
  )
}
