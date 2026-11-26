'use client'
import { useMemo, useState } from 'react'
import type { Hex } from 'viem'
import { Button } from '../ui/Button'
import { copy } from '../../lib/copy'

export type BadgeSnippetProps = {
  targetId: Hex
}

const FALLBACK_ORIGIN = 'https://sealflare.xyz'

/**
 * The security badge for a README. It links to the page of the target itself, never to the
 * landing page, so the badge always names the work it stands for.
 */
export function BadgeSnippet({ targetId }: BadgeSnippetProps) {
  const [copied, setCopied] = useState(false)
  const origin = typeof window === 'undefined' ? FALLBACK_ORIGIN : window.location.origin
  const snippet = useMemo(
    () => `[![Sealflare](${origin}/badge.svg)](${origin}/app/t/${targetId})`,
    [origin, targetId],
  )

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="sf-stack" aria-label={copy.publish.badgeTitle}>
      <p>{copy.publish.badgeIntro}</p>
      <pre className="sf-share__snippet mono">{snippet}</pre>
      <Button onClick={() => void copySnippet()}>{copied ? copy.publish.copied : copy.publish.badgeCopy}</Button>
    </section>
  )
}
