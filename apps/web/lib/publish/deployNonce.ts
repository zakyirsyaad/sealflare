import { getContractAddress, type Address } from 'viem'

/**
 * How many creation nonces are tried at most. A deployer that made more contracts than this is
 * rare, and the search stops rather than freezing the page.
 */
export const MAX_NONCE_SEARCH = 10_000

/**
 * The nonce that made the deployer the creator of the contract: the address a CREATE from the
 * deployer at that nonce produces has to be the contract itself.
 */
export async function findDeployNonce(
  deployer: Address,
  contract: Address,
  currentNonce: number,
): Promise<bigint | null> {
  const upper = Math.min(currentNonce - 1, MAX_NONCE_SEARCH)
  for (let nonce = 0; nonce <= upper; nonce += 1) {
    const created = getContractAddress({ from: deployer, nonce: BigInt(nonce) })
    if (created.toLowerCase() === contract.toLowerCase()) return BigInt(nonce)
  }
  return null
}
