'use client'
import { useConnect, useConnectors } from 'wagmi'
import { Button } from '../ui/Button'
import { translateContractError } from '../../lib/chain/errors'
import { connectorLabel, visibleConnectors } from '../../lib/wallet/connectors'
import { copy } from '../../lib/copy'

export type ConnectSectionProps = {
  /** Why the wallet is needed. */
  what?: string
}

/**
 * The wallet has to be connected before anything can be signed.
 *
 * The list of wallets is the one every screen shows, so a wallet that is found twice is never
 * offered twice. A connection that fails is named, so the reader knows that the wallet is the
 * reason and not the page. A refusal in the wallet says nothing, because the reader knows it.
 */
export function ConnectSection({ what = copy.wallet.connectIntro }: ConnectSectionProps) {
  const connectors = useConnectors()
  const { mutate, isPending, error } = useConnect()
  const failed = error !== null && error !== undefined && translateContractError(error) !== null
  return (
    <section className="sf-stack">
      <h3 className="sf-stack__title">{copy.wallet.connectTitle}</h3>
      <p className="sf-lead">{what}</p>
      <ul className="sf-connectors">
        {visibleConnectors(connectors).map(connector => (
          <li key={connector.uid}>
            <Button className="sf-btn--block" disabled={isPending} onClick={() => mutate({ connector })}>
              {connectorLabel(connector)}
            </Button>
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="sf-error">
          {copy.wallet.connectFailed}
        </p>
      )}
    </section>
  )
}
