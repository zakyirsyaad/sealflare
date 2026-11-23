import { matches, textCheck } from './common'

const PATTERN = /\b(?:MAX_UINT256|ethers\.MaxUint256|maxUint256|type\s*\(\s*uint256\s*\)\s*\.\s*max|2\s*\*\*\s*256\s*-\s*1|0x[f]{64}|115792089237316195423570985008687907853269984665640564039457584007913129639935|unlimited\s+approval|approve\s+all)\b/gi
export const unlimitedApproval = textCheck('unlimited_approval', 'UNLIMITED_APPROVAL_REQUEST',
  'Unlimited token approval requested', (text) => matches(text, PATTERN))
