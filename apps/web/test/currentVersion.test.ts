import { expect, test } from 'vitest'
import { scanCurrentVersionHref } from '../lib/currentVersion'

const sha = 'a'.repeat(40)

test('a pinned skill source becomes a link that scans the current head of the repository, not the pinned commit', () => {
  expect(scanCurrentVersionHref(`gh:sealflare/guard@${sha}:skills/guard`))
    .toBe(`/app?q=${encodeURIComponent('https://github.com/sealflare/guard/tree/main/skills/guard')}`)
})

test('a skill at the root of its repository links to the bare repository', () => {
  expect(scanCurrentVersionHref(`gh:sealflare/guard@${sha}:`)).toBe(`/app?q=${encodeURIComponent('https://github.com/sealflare/guard')}`)
})

test.each([[null], [''], ['0x60b9262456de011f7d15a54cdd8c48baaa8b022f'], ['not a source']])(
  'a source that is not a pinned skill (%j) has no current-version link', src => {
    expect(scanCurrentVersionHref(src)).toBeNull()
  })
