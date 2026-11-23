import type { CheckId } from '@sealflare/shared/schemas'
import type { SkillCheck } from './common'
import { zeroWidth } from './zeroWidth'
import { unlimitedApproval } from './unlimitedApproval'
import { hardcodedTransfer } from './hardcodedTransfer'
import { pipeToShell } from './pipeToShell'
import { externalDependency } from './externalDependency'
import { helperScripts } from './helperScripts'

export type { SkillCheck } from './common'
export function skillChecks(): readonly { id: CheckId; run: SkillCheck }[] {
  return [
    { id: 'zero_width_unicode', run: zeroWidth },
    { id: 'unlimited_approval', run: unlimitedApproval },
    { id: 'hardcoded_transfer', run: hardcodedTransfer },
    { id: 'pipe_to_shell', run: pipeToShell },
    { id: 'external_dependency', run: externalDependency },
    { id: 'helper_scripts', run: helperScripts },
  ]
}
