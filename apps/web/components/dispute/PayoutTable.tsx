import type { ChallengeDetail } from '@sealflare/shared/schemas'
import { copy } from '../../lib/copy'
import { formatBnb, shortAddress } from '../../lib/format'

/** Who received what when the dispute ended. The balances are withdrawn from the Vault later. */
export function PayoutTable({ payouts }: { payouts: ChallengeDetail['payouts'] }) {
  if (payouts.length === 0) return <p className="sf-lead">{copy.dispute.noPayouts}</p>
  return (
    <table className="sf-table">
      <caption>{copy.dispute.payouts}</caption>
      <thead>
        <tr>
          <th scope="col">{copy.dispute.recipient}</th>
          <th scope="col">{copy.dispute.amount}</th>
        </tr>
      </thead>
      <tbody>
        {payouts.map(payout => (
          <tr key={payout.recipient}>
            <td className="sf-mono" data-label={copy.dispute.recipient}>
              {shortAddress(payout.recipient)}
            </td>
            <td className="sf-mono" data-label={copy.dispute.amount}>
              {formatBnb(payout.amount)} BNB
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
