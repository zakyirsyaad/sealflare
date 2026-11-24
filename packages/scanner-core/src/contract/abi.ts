import { z } from 'zod'

type Parameter = { type: string; name?: string; indexed?: boolean; components?: Parameter[] }

function validType(type: string): boolean {
  if (!/^[a-z][a-z0-9]*(?:\[(?:[1-9][0-9]*)?\])*$/.test(type)) return false
  const base = type.split('[')[0]!
  if (/^(address|bool|string|function|tuple|bytes|u?int|u?fixed)$/.test(base)) return true
  const bytes = /^bytes([1-9][0-9]*)$/.exec(base)
  if (bytes) return Number(bytes[1]) <= 32
  const integer = /^u?int([1-9][0-9]*)$/.exec(base)
  if (integer) return Number(integer[1]) <= 256 && Number(integer[1]) % 8 === 0
  const fixed = /^u?fixed([1-9][0-9]*)x([1-9][0-9]*)$/.exec(base)
  return !!fixed && Number(fixed[1]) <= 256 && Number(fixed[1]) % 8 === 0 && Number(fixed[2]) <= 80
}

const Parameter: z.ZodType<Parameter> = z.lazy(() => z.object({
  type: z.string().refine(validType), name: z.string().optional(), indexed: z.boolean().optional(),
  components: z.array(Parameter).optional(),
}).refine((value) => value.type.split('[')[0] === 'tuple' ? value.components !== undefined : value.components === undefined))

const name = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/)
const inputs = z.array(Parameter)
const stateMutability = z.enum(['pure', 'view', 'nonpayable', 'payable'])

/** Validate JSON ABI structure before name heuristics can establish a passed check. */
export const Abi = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('function'), name, inputs, outputs: inputs, stateMutability }),
  z.object({ type: z.literal('constructor'), inputs, stateMutability: z.enum(['nonpayable', 'payable']) }),
  z.object({ type: z.literal('event'), name, anonymous: z.boolean(),
    inputs: z.array(Parameter.refine((parameter) => parameter.indexed !== undefined)) }),
  z.object({ type: z.literal('error'), name, inputs }),
  z.object({ type: z.literal('fallback'), stateMutability: z.enum(['nonpayable', 'payable']) }),
  z.object({ type: z.literal('receive'), stateMutability: z.literal('payable') }),
]))
