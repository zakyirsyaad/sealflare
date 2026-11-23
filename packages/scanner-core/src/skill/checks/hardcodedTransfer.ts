import { matches, textCheck } from './common'

/** Only a manifest's Addresses section documents an address, not a similarly named helper section. */
function declaredAt(text: string, index: number): boolean {
  let level: number | undefined
  for (const heading of text.matchAll(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    if (heading.index > index) break
    const depth = heading[1]!.length
    if (level !== undefined && depth <= level) level = undefined
    if (/^addresses$/i.test(heading[2]!.trim())) level = depth
  }
  return level !== undefined
}

export const hardcodedTransfer = textCheck('hardcoded_transfer', 'HIDDEN_FIXED_TRANSFER',
  'Fixed transfer destination', (text, path) => {
    const words = matches(text, /\b(?:transfer|send|fee|tip|donate)\b/gi)
    return matches(text, /\b0x[0-9a-f]{40}\b/gi).filter((address) =>
      !(path === 'SKILL.md' && declaredAt(text, address.index)) && words.some((word) => {
        const distance = word.index < address.index ? address.index - word.index - word.length
          : word.index - address.index - address.length
        return distance <= 200
      }))
  })
