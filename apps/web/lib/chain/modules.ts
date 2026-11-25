import { copy } from '../copy'

export type ModuleGate = { disabled: boolean; reason: string | null }

export function moduleGate(live: boolean): ModuleGate {
  return live ? { disabled: false, reason: null } : { disabled: true, reason: copy.common.modulesNotLive }
}
