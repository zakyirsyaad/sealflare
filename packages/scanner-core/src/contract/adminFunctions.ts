import type { FlagName } from '@sealflare/shared/rules'
import { z } from 'zod'

const FunctionEntry = z.object({
  type: z.literal('function'), name: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/),
  stateMutability: z.enum(['pure', 'view', 'nonpayable', 'payable']).optional(),
})
const PATTERNS: readonly [RegExp, FlagName][] = [
  [/^mint/i, 'HIDDEN_MINT'],
  [/^(pause|freeze|lock|disableTransfer)/i, 'PAUSE_OR_FREEZE_FUNDS'],
  [/^(setTax|setFee|updateFee|setSellFee|setBuyFee)/i, 'MUTABLE_OR_HIGH_TAX'],
  [/^(blacklist|addToBlacklist|ban|setBot|excludeFromTransfer)/i, 'HONEYPOT_OR_BLACKLIST'],
  [/^(transferFromAny|sweep|drain|multicallTransferFrom)/i, 'PERMIT_OR_DRAINER_PATTERN'],
]

/** S3: name heuristics only, not control-flow or permission analysis. */
export function findAdminFunctions(abi: unknown): { name: string; flag: FlagName }[] {
  if (!Array.isArray(abi)) return []
  const functions = abi.flatMap((entry: unknown) => {
    const parsed = FunctionEntry.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
  const capped = functions.some(({ name }) => /^(cap|maxSupply)$/i.test(name))
  return functions.flatMap(({ name, stateMutability }) => {
    if (stateMutability === 'view' || stateMutability === 'pure') return []
    const match = PATTERNS.find(([pattern]) => pattern.test(name))
    return match && !(capped && match[1] === 'HIDDEN_MINT') ? [{ name, flag: match[1] }] : []
  })
}
