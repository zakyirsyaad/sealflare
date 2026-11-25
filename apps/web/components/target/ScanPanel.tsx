'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseScanInput, type ScanInput } from '@sealflare/scanner-core'
import { CONTRACT_CHECK_IDS, SKILL_CHECK_IDS, ScanError as ScanInputError, encodeSrc } from '@sealflare/shared/schemas'
import { api, ApiError } from '../../lib/api/client'
import { copy } from '../../lib/copy'
import { ScanError } from './ScanError'
import { ScanField } from './ScanField'
import { ScanProgress } from './ScanProgress'

const TICK_MS = 600

type State =
  | { kind: 'idle' }
  | { kind: 'scanning'; input: ScanInput; done: number }
  | { kind: 'failed'; error: ApiError; input: ScanInput | null }

function checksOf(input: ScanInput): readonly string[] {
  return input.kind === 'contract' ? CONTRACT_CHECK_IDS : SKILL_CHECK_IDS
}

function skillUrl(input: Extract<ScanInput, { kind: 'skill' }>): string {
  return `https://github.com/${input.owner}/${input.repo}`
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof ScanInputError) return new ApiError(error.code, error.message, error.details)
  return new ApiError('INTERNAL', 'The scan service could not be reached.')
}

export type ScanPanelProps = {
  /** The query the landing page sends, `?q=`. It starts the scan at once. */
  initialQuery?: string
}

/** The Scan screen: one field, a checklist that ticks off while it runs, and every scan error. */
export function ScanPanel({ initialQuery = '' }: ScanPanelProps) {
  const router = useRouter()
  const [text, setText] = useState(initialQuery)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const started = useRef(false)

  const run = useCallback(
    async (input: ScanInput) => {
      setState({ kind: 'scanning', input, done: 0 })
      try {
        const report =
          input.kind === 'contract'
            ? await api.scanContract(input.address)
            : await api.scanSkill(skillUrl(input), input.path)
        router.push(`/app/t/${report.targetId}?src=${encodeURIComponent(encodeSrc(report.source))}`)
      } catch (error) {
        setState({ kind: 'failed', error: toApiError(error), input })
      }
    },
    [router],
  )

  const submit = useCallback(() => {
    let input: ScanInput
    try {
      input = parseScanInput(text)
    } catch (error) {
      setState({ kind: 'failed', error: toApiError(error), input: null })
      return
    }
    void run(input)
  }, [run, text])

  useEffect(() => {
    if (started.current || !initialQuery) return
    started.current = true
    submit()
  }, [initialQuery, submit])

  useEffect(() => {
    if (state.kind !== 'scanning') return
    const total = checksOf(state.input).length
    if (state.done >= total) return
    const timer = setTimeout(() => {
      setState(current => (current.kind === 'scanning' ? { ...current, done: current.done + 1 } : current))
    }, TICK_MS)
    return () => clearTimeout(timer)
  }, [state])

  const scanning = state.kind === 'scanning'
  return (
    <div className="sf-stack">
      <ScanField value={text} onChange={setText} onSubmit={submit} busy={scanning} />
      <p className="sf-lead">{copy.scan.help}</p>
      {scanning && (
        <ScanProgress checks={checksOf(state.input)} done={state.done} />
      )}
      {state.kind === 'failed' && (
        <ScanError
          error={state.error}
          onChooseFolder={folder => {
            const input = state.input
            if (!input || input.kind !== 'skill') return
            void run({ ...input, path: folder })
          }}
        />
      )}
    </div>
  )
}
