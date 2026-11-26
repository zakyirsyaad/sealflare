'use client'
import { useState } from 'react'
import type { Address } from 'viem'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { canKeepRevealCode, commitHashFor, loadRevealCode, newRevealCode } from '../../lib/revealCode'
import { AttestButton } from '../attest/AttestButton'
import type { AttestState } from '../attest/useAttest'
import type { JurorState } from './useJuror'

export type RevealCodeStepProps = {
  challengeId: bigint
  /** The wallet that commits. Its commit hash names the file of the code. */
  account: Address
  uphold: boolean
  state: AttestState
  error: string | null
  txHash: string | null
  /** The time the reveal window opens and closes, as the screens write it. */
  window: string
  /** The browser would not keep a copy of the code. */
  keptFailed: boolean
  /** The Court is being asked whether it holds the commit. */
  checking: boolean
  /** The commit the Court holds for this wallet, or null when it holds none. */
  held: JurorState | null
  onCommit: (code: string) => void
  onBack: () => void
}

/** Hands the text to the clipboard. False when the browser refuses. */
async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Offers the code as a file. The URL of the file is released at once, and the code is in no URL.
 *
 * The name carries the start of the commit hash, which is public on the chain, so the files of two
 * attempts never share a name and the second cannot hide the first.
 */
function download(code: string, challengeId: bigint, account: Address, window: string): void {
  // The file carries the reveal window too, so a juror who reveals from another device knows when
  // to come back without asking the app.
  const url = URL.createObjectURL(new Blob([`${code}\n${window}\n`], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `sealflare-reveal-code-${challengeId.toString()}-${commitHashFor(code, account).slice(2, 10)}.txt`
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * The confirmation of a commit: it says that nothing will remind the juror, and gives the time to copy.
 *
 * A browser that would not keep the code is asked for a download here, because the file is then the
 * only copy the juror has, and the commit is already on the chain.
 */
function Confirmation({ window, keptFailed, onDownload }: { window: string; keptFailed: boolean; onDownload: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <section className="sf-stack">
      <p className="sf-opt__title">{copy.jury.committedTitle}</p>
      <p className="sf-lead">{copy.jury.noReminder}</p>
      <p className="sf-lead sf-mono">{window}</p>
      <p className="sf-lead">{copy.jury.copyTimeNote}</p>
      <Button
        onClick={async () => {
          if (await toClipboard(window)) setCopied(true)
        }}
      >
        {copied ? copy.jury.timeCopied : copy.jury.copyTime}
      </Button>
      {keptFailed && (
        <>
          <p className="sf-lead">{copy.jury.downloadAgainRequired}</p>
          <Button onClick={onDownload}>{copy.jury.downloadCode}</Button>
        </>
      )}
    </section>
  )
}

/**
 * Whether the juror has taken the code with them. Copying or downloading is enough, unless this
 * browser cannot keep a copy: then only a file counts, because the clipboard is easily replaced.
 */
function useHandout(code: string, challengeId: bigint, account: Address, window: string) {
  const [canKeep] = useState(canKeepRevealCode)
  const [copied, setCopied] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  return {
    canKeep,
    taken: canKeep ? copied || downloaded : downloaded,
    copied,
    downloaded,
    copyFailed,
    copyCode: async () => {
      const ok = await toClipboard(code)
      setCopyFailed(!ok)
      // A copy that worked stays copied, even if a later attempt is refused.
      if (ok) setCopied(true)
    },
    downloadCode: () => {
      download(code, challengeId, account, window)
      setDownloaded(true)
    },
  }
}

/**
 * What the Court holds when it holds another code than the one of this panel.
 *
 * Only the code that was committed can reveal the vote, so the panel says so, and it points at the
 * code this browser keeps when it keeps it.
 */
function CommittedElsewhere({ held, challengeId, account }: { held: JurorState; challengeId: bigint; account: Address }) {
  const saved = loadRevealCode(challengeId, account, held.commitHash) !== null
  return (
    <section className="sf-stack">
      <p className="sf-lead">{copy.jury.committedElsewhere}</p>
      {saved && <p className="sf-lead">{copy.jury.committedCodeSaved}</p>}
    </section>
  )
}

/**
 * The third step: the reveal code, which the juror has to copy or download before the commit.
 *
 * The code is made once, when the step opens, and is never derived from a signature. The commit
 * button stays closed until the juror has taken the code with them.
 */
export function RevealCodeStep(props: RevealCodeStepProps) {
  const [code] = useState(() => newRevealCode(props.challengeId, props.uphold))
  const handout = useHandout(code, props.challengeId, props.account, props.window)
  const held = props.held
  // The commit on the chain is the one of this panel only when the hash says so.
  const mine = held !== null && held.commitHash === commitHashFor(code, props.account).toLowerCase()
  const elsewhere = held !== null && !mine
  return (
    <>
      <section className="sf-stack">
        <p className="sf-lead">{copy.jury.codeWhy}</p>
        <label className="sf-opt__title" htmlFor="reveal-code">
          {copy.jury.codeLabel}
        </label>
        <input id="reveal-code" className="sf-input" readOnly value={code} onFocus={event => event.currentTarget.select()} />
        <div className="sf-flags">
          <Button onClick={handout.copyCode}>{handout.copied ? copy.jury.copied : copy.jury.copyCode}</Button>
          <Button onClick={handout.downloadCode}>{handout.downloaded ? copy.jury.downloaded : copy.jury.downloadCode}</Button>
        </div>
        {handout.copyFailed && <p className="sf-lead">{copy.jury.copyFailed}</p>}
        {!handout.canKeep && <p className="sf-lead">{copy.jury.downloadRequired}</p>}
        {handout.canKeep && !handout.taken && <p className="sf-lead">{copy.jury.codeRequired}</p>}
        <p className="sf-lead">{props.keptFailed ? copy.jury.localFailed : copy.jury.localNote}</p>
      </section>
      {props.checking && <p className="sf-lead" role="status">{copy.jury.verifying}</p>}
      {(props.state === 'done' || mine) && (
        <Confirmation window={props.window} keptFailed={props.keptFailed} onDownload={handout.downloadCode} />
      )}
      {elsewhere && held !== null && <CommittedElsewhere held={held} challengeId={props.challengeId} account={props.account} />}
      <footer className="sf-panel__footer">
        {/* A vote the Court already holds has nothing to retry, so no button is offered. */}
        {!mine && !elsewhere && (
          <AttestButton
            state={props.state}
            error={props.error}
            txHash={props.txHash}
            label={copy.jury.commit}
            disabled={!handout.taken}
            onSubmit={() => props.onCommit(code)}
            onRetry={() => props.onCommit(code)}
          />
        )}
        <Button disabled={props.state !== 'idle'} onClick={props.onBack}>
          {copy.attest.back}
        </Button>
      </footer>
    </>
  )
}
