import { expect, test } from 'vitest'
import { cursorIdOf } from '../src/cursor'

const CORE = '0xAbCd000000000000000000000000000000000001'
const COURT = '0x0000000000000000000000000000000000000002'
const VAULT = '0x0000000000000000000000000000000000000003'

test('the cursor of the Core alone is its address, so an existing database keeps its cursor', () => {
  expect(cursorIdOf({ core: CORE })).toBe(CORE.toLowerCase())
  expect(cursorIdOf({ core: CORE, court: null, vault: undefined })).toBe(CORE.toLowerCase())
})

test('a run that also reads the Court and the Vault does not reuse the cursor of the Core alone', () => {
  const coreOnly = cursorIdOf({ core: CORE })
  expect(cursorIdOf({ core: CORE, court: COURT, vault: VAULT })).not.toBe(coreOnly)
  expect(cursorIdOf({ core: CORE, court: COURT })).not.toBe(coreOnly)
  expect(cursorIdOf({ core: CORE, vault: VAULT })).not.toBe(coreOnly)
})

test('every set of contracts has a cursor of its own', () => {
  const ids = [
    cursorIdOf({ core: CORE, court: COURT, vault: VAULT }),
    cursorIdOf({ core: CORE, court: COURT }),
    cursorIdOf({ core: CORE, vault: VAULT }),
  ]
  expect(new Set(ids).size).toBe(3)
})
