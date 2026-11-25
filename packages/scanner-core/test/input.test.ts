import { expect, test } from 'vitest'
import { parseScanInput } from '../src/input'

const commit = 'a'.repeat(40)
test.each([
  ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', { kind: 'contract', address: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed' }],
  ['0x52908400098527886E0F7030069857D2E4169EE7', { kind: 'contract', address: '0x52908400098527886e0f7030069857d2e4169ee7' }],
  ['  0x1234567890abcdef1234567890abcdef12345678\n', { kind: 'contract', address: '0x1234567890abcdef1234567890abcdef12345678' }],
  ['https://github.com/acme/skills', { kind: 'skill', owner: 'acme', repo: 'skills' }],
  ['https://github.com/acme/skills.git', { kind: 'skill', owner: 'acme', repo: 'skills' }],
  ['github.com/acme/skills/tree/main/swap-helper', { kind: 'skill', owner: 'acme', repo: 'skills', branch: 'main', path: 'swap-helper' }],
  ['https://github.com/acme/skills/tree/main', { kind: 'skill', owner: 'acme', repo: 'skills', branch: 'main' }],
  [`https://github.com/acme/skills/tree/${commit}/a/b`, { kind: 'skill', owner: 'acme', repo: 'skills', commit, path: 'a/b' }],
  [`gh:acme/skills@${commit}:swap-helper`, { kind: 'skill', owner: 'acme', repo: 'skills', commit, path: 'swap-helper' }],
  [`gh:acme/skills@${commit}:`, { kind: 'skill', owner: 'acme', repo: 'skills', commit, path: '' }],
  [`gh:acme/skills.git@${commit}:swap`, { kind: 'skill', owner: 'acme', repo: 'skills.git', commit, path: 'swap' }],
  [`https://github.com/acme/skills/tree/${commit}`, { kind: 'skill', owner: 'acme', repo: 'skills', commit }],
  ['https://github.com/acme/skills/', { kind: 'skill', owner: 'acme', repo: 'skills' }],
  [`https://github.com/acme/skills/tree/${'A'.repeat(40)}/x%20y`, { kind: 'skill', owner: 'acme', repo: 'skills', commit, path: 'x y' }],
])('parses %s', (input, expected) => expect(parseScanInput(input)).toEqual(expected))

test.each([
  '', 'hello', '0x1234', 'https://gitlab.com/a/b', 'https://github.com/acme', 'javascript:alert(1)',
  'https://github.com/acme/skills/tree/main/../../etc', 'https://github.com/acme/skills/tree/main/%2e%2e/etc',
  'https://github.com/acme/skills/tree/main/x/..', 'https://github.com/acme/skills/tree/main/x\\y',
  'https://github.com/acme/skills/tree/main/%00', 'https://github.com/acme/skills/tree/main/%0a',
  'https://github.com/acme/skills/tree/main/%zz', 'https://github.com/../skills', 'https://github.com/acme/..',
  'https://github.com@evil.example/acme/skills', 'https://github.com.evil.example/acme/skills',
  'https://user:secret@github.com/acme/skills', 'https://github.com:123/acme/skills',
  'https://github.com/acme/skills/blob/main/SKILL.md',
  'https://github.com/acme/skills/tree/feature/swap', `gh:acme/skills@${commit}:../x`,
  'https://github.com/acme/skills/tree/main//x', 'https://github.com/acme/.git',
  `gh:acme/skills@${'A'.repeat(40)}:swap`,
  '0x1234567890abcdef1234567890ABCDEF12345678',
  '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
])('rejects %s with INPUT_NOT_RECOGNIZED', (input) => {
  expect(() => parseScanInput(input)).toThrowError(expect.objectContaining({ code: 'INPUT_NOT_RECOGNIZED' }))
})

test.each([
  'http://github.com/acme/skills', 'https://www.github.com/acme/skills', 'www.github.com/acme/skills',
  'https://github.com/acme/skills?tab=readme-ov-file', 'https://github.com/acme/skills#readme',
  'HTTP://WWW.GITHUB.COM/acme/skills?tab=readme-ov-file#readme',
])('accepts GitHub presentation URL %s without changing the repository identity', (text) => {
  expect(parseScanInput(text)).toEqual({ kind: 'skill', owner: 'acme', repo: 'skills' })
})

test('query and fragment on a pinned folder preserve the commit and folder', () => {
  expect(parseScanInput(`http://www.github.com/acme/skills/tree/${commit}/swap?tab=readme-ov-file#readme`))
    .toEqual({ kind: 'skill', owner: 'acme', repo: 'skills', commit, path: 'swap' })
})

test.each([
  'http://www.github.com/acme/skills/tree/main/%2E%2E/etc?tab=readme',
  'https://www.github.com@evil.example/acme/skills#readme',
  'https://www.github.com.evil.example/acme/skills?tab=readme',
  'https://www.github.com/acme/skills/tree/main/x\\..\\etc',
])('URL convenience variants still reject unsafe input %s', (text) => {
  expect(() => parseScanInput(text)).toThrowError(expect.objectContaining({ code: 'INPUT_NOT_RECOGNIZED' }))
})
