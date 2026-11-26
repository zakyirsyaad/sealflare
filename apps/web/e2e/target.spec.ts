import { expect, test } from '@playwright/test'

// The skill target of the local chain, seeded with two danger votes and two flags.
// Its id is the same on every machine, because it comes from the frozen vectors.
const SKILL_TARGET = '0xa01952409246800ff1ca8031688af18ac78d9218bdb89a3c62a13b2599278377'
const LOCAL_RPC = 'http://127.0.0.1:8545'

/** The local chain has to run, and the app has to be built for it. */
async function localChainRuns(): Promise<boolean> {
  try {
    const response = await fetch(LOCAL_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    })
    const body = (await response.json()) as { result?: string }
    return body.result === '0x7a69'
  } catch {
    return false
  }
}

test('the target page fits a narrow screen and keeps the attest action at the bottom edge', async ({ page }) => {
  test.skip(!(await localChainRuns()), 'The local chain has to run: pnpm chain and pnpm chain:seed.')
  await page.setViewportSize({ width: 375, height: 800 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`/app/t/${SKILL_TARGET}`)

  const tier = page.getByRole('heading', { name: 'Caution flagged' })
  const found = await tier
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  test.skip(!found, 'The app is not built for the local chain: build it with NEXT_PUBLIC_CHAIN_ID=31337.')
  await expect(tier).toBeVisible()

  // The flags of the seeded votes live in the attestations tab, so the tab is opened first.
  await page.getByRole('tab', { name: /Attestations/ }).click()
  await expect(page.getByText('Trojan helper script').first()).toBeVisible()
  await expect(page.getByText('Unlimited approval request').first()).toBeVisible()

  const actions = page.getByRole('complementary', { name: 'Attest' })
  await expect(actions).toBeVisible()
  await expect(actions.getByRole('button', { name: 'Attest', exact: true })).toBeVisible()

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const box = await actions.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  // The column sticks to the bottom edge of the screen on a narrow one.
  expect(Math.abs(box!.y + box!.height - viewport!.height)).toBeLessThan(2)
  expect(errors).toEqual([])
})
