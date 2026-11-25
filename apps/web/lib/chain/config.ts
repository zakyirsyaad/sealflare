import { createConfig, http } from 'wagmi'
import { bsc, foundry } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'
import { publicEnv } from '../env.public'

export const expectedChainId = publicEnv.NEXT_PUBLIC_CHAIN_ID
export const modulesLive = publicEnv.NEXT_PUBLIC_MODULES_LIVE
export const agentIdUrl = publicEnv.NEXT_PUBLIC_AGENT_ID_URL

export function createWagmiConfig(projectId = publicEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) {
  return createConfig({
    chains: [bsc, foundry],
    ssr: true,
    connectors: [injected(), ...(projectId ? [walletConnect({ projectId })] : [])],
    transports: { [bsc.id]: http(), [foundry.id]: http() },
  })
}
