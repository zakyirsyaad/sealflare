import { hexToBytes, type Hex } from 'viem'
import { z } from 'zod'

export const Bytecode = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).transform((value) => value as Hex)

/** Mirrors the conservative instruction walk in contracts/src/lib/BytecodeScan.sol. */
export function hasDelegatecall(code: Hex): boolean {
  const bytes = hexToBytes(Bytecode.parse(code))
  let tailStart = bytes.length
  if (bytes.length >= 2) {
    const length = (bytes[bytes.length - 2]! << 8) | bytes[bytes.length - 1]!
    if (length + 2 < bytes.length) tailStart = bytes.length - length - 2
  }
  let previous = 0
  for (let cursor = 0; cursor < bytes.length;) {
    if (cursor === tailStart && previous === 0xfe && !bytes.subarray(tailStart).includes(0x5b)) return false
    const opcode = bytes[cursor]!
    if (opcode === 0xf4) return true
    cursor += opcode >= 0x60 && opcode <= 0x7f ? opcode - 0x5f + 1 : 1
    previous = opcode
  }
  return false
}
