'use client'
import { useConnect, useConnectors, type Connector } from 'wagmi'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { translateContractError } from '../../lib/chain/errors'
import { copy } from '../../lib/copy'

const label = (connector: Connector) => (connector.id === 'walletConnect' ? copy.wallet.walletConnect : connector.name)

export function ConnectPrompt({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors()
  const { mutate, isPending, error } = useConnect()
  const hasQr = connectors.some(connector => connector.id === 'walletConnect')
  const failed = error !== null && error !== undefined && translateContractError(error) !== null
  return <Panel title={copy.wallet.connectTitle} onClose={onClose}>
    <p className="sf-lead">{copy.wallet.connectIntro}</p>
    <ul className="sf-connectors">
      {connectors.map(connector => <li key={connector.uid}>
        <Button className="sf-btn--block" disabled={isPending} onClick={() => mutate({ connector }, { onSuccess: onClose })}>{label(connector)}</Button>
      </li>)}
    </ul>
    {failed && <p role="alert" className="sf-lead">{copy.wallet.connectFailed}</p>}
    {(isPending || hasQr) && <p className="sf-lead">{isPending ? copy.wallet.connecting : copy.wallet.mobileQr}</p>}
  </Panel>
}
