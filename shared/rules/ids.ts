import { type Address, type Hex, encodeAbiParameters, keccak256 } from 'viem'

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

const TARGET_TYPE_CONTRACT = 0
const TARGET_TYPE_SKILL = 1

// viem rejects a mixed-case address whose checksum is wrong; the hash must not depend on letter case.
const lower = (address: Address): Address => address.toLowerCase() as Address

/** keccak256(abi.encode(contentHash, manifestPublisher)). Mirrors Ids.canonicalBundleHashOf. */
export function canonicalBundleHash(contentHash: Hex, manifestPublisher: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }], [contentHash, lower(manifestPublisher)]))
}

/** keccak256(abi.encode(TargetType.SMART_CONTRACT, address)). Mirrors Ids.targetIdOfContract. */
export function targetIdOfContract(address: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'address' }], [TARGET_TYPE_CONTRACT, lower(address)]))
}

/** keccak256(abi.encode(TargetType.AI_SKILL_BUNDLE, canonicalBundleHash)). Mirrors Ids.targetIdOfSkill. */
export function targetIdOfSkill(canonicalHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }], [TARGET_TYPE_SKILL, canonicalHash]))
}
