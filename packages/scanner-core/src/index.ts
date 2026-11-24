import type { ScannerCore } from '@sealflare/shared/schemas'
import { scanContract } from './contract/scanContract'
import { scanSkill } from './skill/scanSkill'

export { parseScanInput, type ScanInput } from './input'
export { suggestVerdict, SEVERE_FLAGS } from './verdict'
export { hasDelegatecall } from './contract/bytecode'
export { inspectProxy, type ProxyInfo } from './contract/proxy'

/** Stateless core. Callers provide every RPC, explorer and repository dependency. */
export function createScanner(): ScannerCore {
  return { scanContract, scanSkill }
}
