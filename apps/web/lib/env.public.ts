import { parsePublicEnv } from './env.schema'
// Explicit references are required for Next.js to inline public variables in client bundles.
export const publicEnv = parsePublicEnv({
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  NEXT_PUBLIC_MODULES_LIVE: process.env.NEXT_PUBLIC_MODULES_LIVE,
  NEXT_PUBLIC_AGENT_ID_URL: process.env.NEXT_PUBLIC_AGENT_ID_URL,
})
