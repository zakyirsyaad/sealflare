import { matches, textCheck } from './common'

export const zeroWidth = textCheck('zero_width_unicode', 'OBFUSCATED_UNICODE_INJECTION',
  'Hidden Unicode characters', (text) => matches(text,
    /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu)
    .filter(({ index }) => index !== 0 || text[0] !== '\ufeff'))
