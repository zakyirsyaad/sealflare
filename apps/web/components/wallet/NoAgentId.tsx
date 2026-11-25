import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'

type Props = { recheck: () => void; onOtherWallet: () => void; agentIdUrl?: string }

export function NoAgentId({ recheck, onOtherWallet, agentIdUrl }: Props) {
  return <section className="sf-stack" aria-label={copy.wallet.agentRequired}>
    <h3 className="sf-stack__title">{copy.wallet.agentRequired}</h3>
    <p className="sf-lead">{copy.wallet.agentWhy}</p>
    <Button onClick={onOtherWallet}>{copy.wallet.otherWallet}</Button>
    {agentIdUrl
      ? <a className="sf-btn sf-btn--secondary" href={agentIdUrl} target="_blank" rel="noopener noreferrer">{copy.wallet.getAgentId}</a>
      : <><span>{copy.wallet.getAgentId}</span><p className="sf-lead">{copy.wallet.agentIdLinkPending}</p></>}
    <Button variant="ghost" onClick={recheck}>{copy.wallet.checkAgain}</Button>
  </section>
}
