'use client'
import { useConnect, useConnectors } from 'wagmi'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { translateContractError } from '../../lib/chain/errors'
import { connectorLabel, visibleConnectors } from '../../lib/wallet/connectors'
import { copy } from '../../lib/copy'

export function ConnectPrompt({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors()
  const { mutate, isPending, error } = useConnect()
  const hasQr = connectors.some(connector => connector.id === 'walletConnect')
  // A refusal in the wallet is not a failure the reader has to read about, so it says nothing.
  const failed = error !== null && error !== undefined && translateContractError(error) !== null
  return <Panel title={copy.wallet.connectTitle} onClose={onClose}>
    <p className="sf-lead">{copy.wallet.connectIntro}</p>
    <ul className="sf-connectors">
      {visibleConnectors(connectors).map(connector => <li key={connector.uid}>
        <Button className="sf-btn--block" disabled={isPending} onClick={() => mutate({ connector }, { onSuccess: onClose })}>{connectorLabel(connector)}</Button>
      </li>)}
    </ul>
    {failed && <p role="alert" className="sf-lead">{copy.wallet.connectFailed}</p>}
    {(isPending || hasQr) && <p className="sf-lead">{isPending ? copy.wallet.connecting : copy.wallet.mobileQr}</p>}
  </Panel>
}
