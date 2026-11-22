import type { Address, Hex } from 'viem'
import { z } from 'zod'
import { FLAG_NAMES, TARGET_TYPES, VERDICTS } from '../rules'

export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20 byte hex address')
  .transform((value) => value.toLowerCase() as Address)

export const Bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32 byte hex value')
  .transform((value) => value.toLowerCase() as Hex)

export const SignatureSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2}){64,}$/, 'must be a hex signature of at least 64 bytes')
  .transform((value) => value as Hex)

/** A non-negative integer carried as a decimal string, for values that may not fit a JS number. */
export const UintStringSchema = z.string().regex(/^(0|[1-9][0-9]*)$/, 'must be a decimal integer')

export const IsoDateSchema = z.iso.datetime()
export const FlagsSchema = z.number().int().min(0).max(0xffff)
export const FlagNameSchema = z.enum(FLAG_NAMES)
export const TargetTypeSchema = z.enum(TARGET_TYPES)
export const VerdictSchema = z.enum(VERDICTS)

export const utf8Length = (text: string): number => new TextEncoder().encode(text).length
