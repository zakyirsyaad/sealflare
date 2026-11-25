import { createConfig, http, type Transport } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'
import { publicEnv } from '../env.public'
import { chains } from './chains'

export const expectedChainId = publicEnv.NEXT_PUBLIC_CHAIN_ID
export const modulesLive = publicEnv.NEXT_PUBLIC_MODULES_LIVE
export const agentIdUrl = publicEnv.NEXT_PUBLIC_AGENT_ID_URL

export function createWagmiConfig(projectId = publicEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) {
  const transports = Object.fromEntries(chains.map(chain => [chain.id, http()])) as Record<number, Transport>
  return createConfig({
    chains,
    ssr: true,
    connectors: [injected(), ...(projectId ? [walletConnect({ projectId })] : [])],
    transports,
  })
}
