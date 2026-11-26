import { CONSTANTS, XP } from '@sealflare/shared/rules'
import { copy } from '../../lib/copy'
import { listWithOr } from '../../lib/format'

type Row = { word: string; challenger: string; jurors: string; target: string }

/** The share of the stake that comes back when a dispute expires, from the schedule of the rules. */
const STAKE_BACK = listWithOr(CONSTANTS.EXPIRE_FORFEIT_BPS.map(bps => `${100 - bps / 100}%`))

const ROWS: readonly Row[] = [
  {
    word: copy.dispute.outcomeUpheld,
    challenger: copy.dispute.upheldChallenger,
    jurors: copy.dispute.upheldJurors,
    target: copy.dispute.upheldTarget,
  },
  {
    word: copy.dispute.outcomeRejected,
    challenger: copy.dispute.rejectedChallenger.replace('{xp}', String(XP.CHALLENGER_LOST)),
    jurors: copy.dispute.rejectedJurors,
    target: copy.dispute.backToTier,
  },
  {
    word: copy.dispute.outcomeTied,
    challenger: copy.dispute.tiedChallenger,
    jurors: copy.dispute.tiedJurors,
    target: copy.dispute.backToTier,
  },
  {
    word: copy.dispute.outcomeExpired,
    challenger: copy.dispute.expiredChallenger.replace('{percentages}', STAKE_BACK),
    jurors: copy.dispute.expiredJurors,
    target: copy.dispute.backToTier,
  },
]

/** The four ways a dispute can end, and what each one means for the challenger, the jurors and the target. */
export function Outcomes() {
  return (
    <section className="sf-frame sf-scroll">
      <table className="sf-table sf-outcomes">
        <caption>{copy.dispute.outcomesTitle}</caption>
        <thead>
          <tr>
            <th scope="col">{copy.dispute.colOutcome}</th>
            <th scope="col">{copy.dispute.colChallenger}</th>
            <th scope="col">{copy.dispute.colJurors}</th>
            <th scope="col">{copy.dispute.colTarget}</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(row => (
            <tr key={row.word}>
              <th scope="row">{row.word}</th>
              <td data-label={copy.dispute.colChallenger}>{row.challenger}</td>
              <td data-label={copy.dispute.colJurors}>{row.jurors}</td>
              <td data-label={copy.dispute.colTarget}>{row.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
