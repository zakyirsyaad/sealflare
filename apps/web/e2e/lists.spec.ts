import { expect, test } from '@playwright/test'

const ADDRESS = '0x60b9262456de011f7d15a54cdd8c48baaa8b022f'

/** One target of the list, in the shape the public API answers with. */
function target(index: number) {
  return {
    targetId: `0x${String(index + 1).padStart(64, '0')}`,
    targetType: 'SMART_CONTRACT',
    label: ADDRESS,
    src: ADDRESS,
    tier: 'CAUTION_FLAGGED',
    safe: 3,
    caution: 1,
    danger: 0,
    publisherRole: 'NONE',
    bond: '0',
    lastVoteAt: '2026-11-25T03:00:00.000Z',
  }
}

/** One Guardian of the list, in the shape the public API answers with. */
function guardian() {
  return { address: ADDRESS, score: 12, weight: 2, attestations: 3, penaltyPending: false }
}

for (const path of ['/app/explore', '/app/guardians']) {
  test(`the list at ${path} fits a 375px screen`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    // The list is answered with rows, so the card of a narrow screen is really measured.
    await page.route('**/api/targets**', route =>
      route.fulfill({
        json: {
          success: true,
          data: { items: [target(0), target(1)] },
          meta: { finalizedBlock: '12345', page: { total: 2, page: 1, limit: 20 } },
        },
      }),
    )
    await page.route('**/api/guardians**', route =>
      route.fulfill({
        json: {
          success: true,
          data: { items: [guardian()] },
          meta: { finalizedBlock: '12345', page: { total: 1, page: 1, limit: 20 } },
        },
      }),
    )
    await page.goto(path)
    await expect(page.getByRole('navigation', { name: 'App' })).toBeVisible()
    await expect(page.getByRole('table')).toBeVisible()
    // Nothing leaves the screen: the filters and the rows stay inside it.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}
