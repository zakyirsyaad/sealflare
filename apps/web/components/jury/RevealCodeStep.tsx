'use client'
import { useState } from 'react'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'
import { newRevealCode } from '../../lib/revealCode'
import { AttestButton } from '../attest/AttestButton'
import type { AttestState } from '../attest/useAttest'

export type RevealCodeStepProps = {
  challengeId: bigint
  uphold: boolean
  state: AttestState
  error: string | null
  txHash: string | null
  /** The time the reveal window opens and closes, as the screens write it. */
  window: string
  /** The browser would not keep a copy of the code. */
  keptFailed: boolean
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

/** Offers the code as a file. The URL of the file is released at once, and the code is in no URL. */
function download(code: string, challengeId: bigint): void {
  const url = URL.createObjectURL(new Blob([`${code}\n`], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `sealflare-reveal-code-${challengeId.toString()}.txt`
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** The confirmation of a commit: it says that nothing will remind the juror, and gives the time to copy. */
function Confirmation({ window }: { window: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <section className="sf-stack">
      <p className="sf-opt__title">{copy.jury.committedTitle}</p>
      <p className="sf-lead">{copy.jury.noReminder}</p>
      <p className="sf-lead sf-mono">{window}</p>
      <Button
        onClick={async () => {
          if (await toClipboard(window)) setCopied(true)
        }}
      >
        {copied ? copy.jury.timeCopied : copy.jury.copyTime}
      </Button>
    </section>
  )
}

/** Whether the juror has taken the code with them, by copying or downloading it. */
function useHandout(code: string, challengeId: bigint) {
  const [copied, setCopied] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  return {
    taken: copied || downloaded,
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
      download(code, challengeId)
      setDownloaded(true)
    },
  }
}

/**
 * The third step: the reveal code, which the juror has to copy or download before the commit.
 *
 * The code is made once, when the step opens, and is never derived from a signature. The commit
 * button stays closed until the juror has taken the code with them.
 */
export function RevealCodeStep(props: RevealCodeStepProps) {
  const [code] = useState(() => newRevealCode(props.challengeId, props.uphold))
  const handout = useHandout(code, props.challengeId)
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
        {!handout.taken && <p className="sf-lead">{copy.jury.codeRequired}</p>}
        <p className="sf-lead">{props.keptFailed ? copy.jury.localFailed : copy.jury.localNote}</p>
      </section>
      {props.state === 'done' && <Confirmation window={props.window} />}
      <footer className="sf-panel__footer">
        <AttestButton
          state={props.state}
          error={props.error}
          txHash={props.txHash}
          label={copy.jury.commit}
          disabled={!handout.taken}
          onSubmit={() => props.onCommit(code)}
          onRetry={() => props.onCommit(code)}
        />
        <Button disabled={props.state !== 'idle'} onClick={props.onBack}>
          {copy.attest.back}
        </Button>
      </footer>
    </>
  )
}
