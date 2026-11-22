import { expect, test } from 'vitest'
import { ZERO_ADDRESS, readManifestPublisher } from '../rules'

const encode = (text: string) => new TextEncoder().encode(text)
const md = (frontmatter: string) => encode(`---\n${frontmatter}\n---\nbody`)
const A = '0x1111111111111111111111111111111111111111'

test('reads metadata.sealflare-publisher', () => {
  expect(readManifestPublisher(md(`name: x\nmetadata:\n  sealflare-publisher: "${A}"`))).toBe(A)
})
test('returns the address in lower case', () => {
  expect(readManifestPublisher(md('metadata:\n  sealflare-publisher: "0xABCDEFabcdef1234567890ABCDEFabcdef123456"'))).toBe(
    '0xabcdefabcdef1234567890abcdefabcdef123456',
  )
})
test('reads an unquoted address, which YAML would otherwise parse as a number', () => {
  expect(readManifestPublisher(md(`metadata:\n  sealflare-publisher: ${A}`))).toBe(A)
})
test('accepts CRLF line endings', () => {
  expect(readManifestPublisher(encode(`---\r\nmetadata:\r\n  sealflare-publisher: "${A}"\r\n---\r\nbody`))).toBe(A)
})
test.each<[string, Uint8Array]>([
  ['no frontmatter', encode('# just text')],
  ['unterminated frontmatter', encode(`---\nmetadata:\n  sealflare-publisher: "${A}"\n`)],
  ['no metadata key', md('name: x')],
  ['metadata that is not a map', md('metadata: hello')],
  ['malformed address', md('metadata:\n  sealflare-publisher: "0x123"')],
  ['duplicate key', md(`metadata:\n  sealflare-publisher: "${A}"\n  sealflare-publisher: "0x2222222222222222222222222222222222222222"`)],
  ['unparseable yaml', md('metadata: [unclosed')],
  ['byte order mark before frontmatter', new Uint8Array([0xef, 0xbb, 0xbf, ...md(`metadata:\n  sealflare-publisher: "${A}"`)])],
  ['invalid UTF-8', new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe, 0x0a, 0x2d, 0x2d, 0x2d])],
  ['empty file', new Uint8Array()],
])('returns the zero address for %s', (_, bytes) => {
  expect(readManifestPublisher(bytes)).toBe(ZERO_ADDRESS)
})
