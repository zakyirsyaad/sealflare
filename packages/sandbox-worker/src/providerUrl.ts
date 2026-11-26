import { z } from 'zod'

export const ProviderUrl = z.url({ protocol: /^https$/ }).refine((value) => {
  const url = new URL(value)
  return !url.username && !url.password && !url.search && !url.hash
}, 'Invalid provider URL.')
