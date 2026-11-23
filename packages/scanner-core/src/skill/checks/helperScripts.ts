import { matches, textCheck } from './common'

const SECRET = /\bprocess\.env\b|\bos\.environ\b|~\/\.ssh\b|\.env\b|\bseed\s+phrase\b|\bmnemonic\b|\bprivate\s+key\b|\bkeystore\b/gi
const NETWORK = /\b(?:fetch|curl)\b|\brequests\.|\baxios\b/i
export const helperScripts = textCheck('helper_scripts', 'CREDENTIAL_OR_KEY_HARVESTING',
  'Helper combines secret access and network calls', (text, path) =>
    path !== 'SKILL.md' && NETWORK.test(text) ? matches(text, SECRET) : [])
