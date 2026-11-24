import { expect, test } from 'vitest'
import { parseScanInput } from '../src/input'

const commit = 'a'.repeat(40)
test.each([
  ['0x1234567890abcdef1234567890ABCDEF12345678', { kind: 'contract', address: '0x1234567890abcdef1234567890abcdef12345678' }],
  ['  0x1234567890abcdef1234567890abcdef12345678\n', { kind: 'contract', address: '0x1234567890abcdef1234567890abcdef12345678' }],
  ['https://github.com/acme/skills', { kind: 'skill', owner: 'acme', repo: 'skills' }],
  ['https://github.com/acme/skills.git', { kind: 'skill', owner: 'acme', repo: 'skills' }],
  ['github.com/acme/skills/tree/main/swap-helper', { kind: 'skill', owner: 'acme', repo: 'skills', branch: 'main', path: 'swap-helper' }],
  ['https://github.com/acme/skills/tree/main', { kind: 'skill', owner: 'acme', repo: 'skills', branch: 'main' }],
  [`https://github.com/acme/skills/tree/${commit}/a/b`, { kind: 'skill', owner: 'acme', repo: 'skills', commit, path: 'a/b' }],
  [`gh:acme/skills@${commit}:swap-helper`, { kind: 'skill', owner: 'acme', repo: 'skills', commit, path: 'swap-helper' }],
  [`gh:acme/skills@${commit}:`, { kind: 'skill', owner: 'acme', repo: 'skills', commit, path: '' }],
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
  'https://github.com/acme/skills/blob/main/SKILL.md', 'https://github.com/acme/skills?ref=other',
  'https://github.com/acme/skills/tree/feature/swap', `gh:acme/skills@${commit}:../x`,
  'https://github.com/acme/skills/tree/main//x', 'https://github.com/acme/.git',
])('rejects %s with INPUT_NOT_RECOGNIZED', (input) => {
  expect(() => parseScanInput(input)).toThrowError(expect.objectContaining({ code: 'INPUT_NOT_RECOGNIZED' }))
})
