/**
 * The network of the caller, as the proxy in front of the app reports it.
 *
 * `x-real-ip` is written by the platform and cannot be changed by the caller, so it is the
 * first choice. `x-forwarded-for` is appended to by every proxy in the chain, so its first entry
 * is the part the caller wrote and its last entry is the one the closest proxy added. The last
 * entry is used, so a caller cannot widen its own limit by sending a header of its own.
 *
 * A request without either header shares one bucket. That is a shared limit of twenty scans in
 * ten minutes, which is what a deployment that hides the caller gets.
 */
export function callerOf(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim()
  if (real !== undefined && real.length > 0) return real
  const chain = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0)
  const last = chain[chain.length - 1]
  return last !== undefined && last.length > 0 ? last : 'unknown'
}
