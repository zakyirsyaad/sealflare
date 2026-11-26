/**
 * The only secret the skill reads from the environment is the RPC endpoint.
 *
 * Nothing else is read, nothing is written, and no key of the project is ever stored here.
 */
export function rpcUrl(override?: string): string {
  const value = (override ?? process.env.RPC_URL ?? '').trim()
  if (!value) throw new Error('Set RPC_URL to a BNB Chain RPC endpoint, or pass --rpc.')
  return value
}
