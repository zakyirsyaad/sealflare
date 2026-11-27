import { createConfig, http, type Transport } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'
import { publicEnv } from '../env.public'
import { chains } from './chains'
import { e2eConnector } from './e2eConnector'

export const expectedChainId = publicEnv.NEXT_PUBLIC_CHAIN_ID
export const modulesLive = publicEnv.NEXT_PUBLIC_MODULES_LIVE
export const agentIdUrl = publicEnv.NEXT_PUBLIC_AGENT_ID_URL
export const isE2eBuild = publicEnv.NEXT_PUBLIC_E2E

export function createWagmiConfig(projectId = publicEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) {
  const transports = Object.fromEntries(chains.map(chain => [chain.id, http()])) as Record<number, Transport>
  return createConfig({
    chains,
    ssr: true,
    // The wallet of the suite is only offered by a build that says it is an end-to-end build.
    connectors: [...(isE2eBuild ? [e2eConnector()] : []), injected(), ...(projectId ? [walletConnect({ projectId })] : [])],
    transports,
  })
}
