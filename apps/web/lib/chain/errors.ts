import { decodeErrorResult, type Abi, type Hex } from 'viem'
import { coreAbi, courtAbi, vaultAbi } from '@sealflare/shared/abi'
import { CONSTANTS } from '@sealflare/shared/rules'
import { copy } from '../copy'
import { formatBnb, formatUtc } from '../format'

export type TranslatedError = { message: string; retry: boolean }
type Decoded = { errorName: string; args: readonly unknown[] }

const errorAbi = [...coreAbi, ...courtAbi, ...vaultAbi].filter(item => item.type === 'error') as unknown as Abi
const sentences = copy.errors as Record<string, string>
const unknown: TranslatedError = { message: copy.errors.unknown, retry: true }

function* causes(error: unknown): Generator<Record<string, unknown>> {
  let current = error
  for (let depth = 0; depth < 10 && typeof current === 'object' && current !== null; depth++) {
    yield current as Record<string, unknown>
    current = (current as { cause?: unknown }).cause
  }
}

function isRejection(error: Record<string, unknown>): boolean {
  return error.code === 4001 || error.code === 5000 || error.name === 'UserRejectedRequestError'
}

function decode(data: unknown): Decoded | null {
  if (typeof data !== 'string' || !/^0x[0-9a-fA-F]{8,}$/.test(data)) return null
  try {
    const { errorName, args } = decodeErrorResult({ abi: errorAbi, data: data as Hex })
    return { errorName, args: args ?? [] }
  } catch {
    return null
  }
}

function findRevert(error: unknown): Decoded | null {
  for (const cause of causes(error)) {
    const data = cause.data as { errorName?: unknown; args?: readonly unknown[] } | undefined
    if (cause.name === 'ContractFunctionRevertedError' && typeof data?.errorName === 'string') {
      return { errorName: data.errorName, args: data.args ?? [] }
    }
    const decoded = decode(cause.raw) ?? decode(cause.data)
    if (decoded) return decoded
  }
  return null
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')
}

function describe({ errorName, args }: Decoded): string | null {
  if (!Object.hasOwn(sentences, errorName)) return null
  const template = sentences[errorName]!
  const [first] = args
  switch (errorName) {
    case 'DailyLimitReached':
      return fill(template, { time: formatUtc(first as bigint), limit: String(CONSTANTS.DAILY_ATTEST_LIMIT) })
    case 'InCooldown':
    case 'WithdrawalNotReady':
      return fill(template, { time: formatUtc(first as bigint) })
    case 'WrongStake':
      return fill(template, { amount: formatBnb(first as bigint) })
    case 'WrongPhase': {
      const phase = copy.phases[Number(first)]
      return phase ? fill(template, { phase }) : null
    }
    case 'ChallengeAlreadyActive':
      return fill(template, { id: String(first) })
    case 'NotEligibleJuror':
      return copy.jurorStatus[Number(first)] ?? template
    default:
      return template
  }
}

// retry is true only for TransferFailed and for errors we cannot name; other reverts repeat identically.
export function translateContractError(error: unknown): TranslatedError | null {
  try {
    if (isUserRejection(error)) return null
    const revert = findRevert(error)
    const message = revert ? describe(revert) : null
    return message ? { message, retry: revert?.errorName === 'TransferFailed' } : unknown
  } catch {
    return unknown
  }
}

// A rejection in the wallet is not a failure the user needs to read about.
export function isUserRejection(error: unknown): boolean {
  try {
    for (const cause of causes(error)) if (isRejection(cause)) return true
    return false
  } catch {
    return false
  }
}
