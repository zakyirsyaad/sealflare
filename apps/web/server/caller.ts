/** The network of the caller, as the proxy in front of the app reports it. */
export function callerOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first !== undefined && first.length > 0 ? first : 'unknown'
}
