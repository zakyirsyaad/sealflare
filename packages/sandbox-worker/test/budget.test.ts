import { expect, test } from 'vitest'
import { createBudget } from '../src/budget'

test('daily calls stop at the limit and reset at the next UTC day', () => {
  let time = new Date('2026-11-25T23:59:59Z')
  const budget = createBudget({ dailyCalls: 3, now: () => time })
  expect(budget.tryTake(2)).toBe(true)
  expect(budget.used()).toBe(2)
  expect(budget.tryTake(2)).toBe(false)
  expect(budget.used()).toBe(2)
  expect(budget.tryTake(1)).toBe(true)
  expect(budget.tryTake(1)).toBe(false)
  time = new Date('2026-11-26T00:00:00Z')
  expect(budget.used()).toBe(0)
  expect(budget.tryTake(3)).toBe(true)
})

test('local midnight does not reset a UTC daily budget', () => {
  let time = new Date('2026-11-25T23:59:59+07:00')
  const budget = createBudget({ dailyCalls: 1, now: () => time })
  budget.tryTake(1)
  time = new Date('2026-11-26T00:00:00+07:00')
  expect(budget.tryTake(1)).toBe(false)
})

test('moving the clock backwards cannot create a second daily allowance', () => {
  let time = new Date('2026-11-25T12:00:00Z')
  const budget = createBudget({ dailyCalls: 1, now: () => time })
  budget.tryTake(1)
  time = new Date('2026-11-24T12:00:00Z')
  expect(budget.tryTake(1)).toBe(false)
})

test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('invalid daily limit %s is rejected', (dailyCalls) => {
  expect(() => createBudget({ dailyCalls })).toThrow()
})

test.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('invalid take %s does not consume quota', (calls) => {
  const budget = createBudget({ dailyCalls: 2 })
  expect(() => budget.tryTake(calls)).toThrow()
  expect(budget.used()).toBe(0)
})

test('an invalid clock fails closed', () => {
  expect(() => createBudget({ dailyCalls: 1, now: () => new Date(NaN) }).tryTake(1)).toThrow()
})

test('admission can check capacity without charging a model call', () => {
  const budget = createBudget({ dailyCalls: 1 })
  expect(budget.canTake(1)).toBe(true)
  expect(budget.canTake(1)).toBe(true)
  expect(budget.used()).toBe(0)
  budget.tryTake(1)
  expect(budget.canTake(1)).toBe(false)
})
