import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { getAddress } from 'viem'
import { targetIdOfContract } from '@sealflare/shared/rules'
import { connectFromHeader, openActor } from './actors'
import { modulesAreLive, offUrl } from './chainTools'
import { seedScreens, type Seed } from './seed'
import { anvilAccount, expect, scanContract, test, usesRealContracts, type Stack } from './fixtures'

/**
 * The screens of the application at the width of a phone, in both themes, and with the modules
 * closed.
 *
 * Against the real contracts the chain holds a closed dispute, a bounty and a sponsor, so the
 * screens that list them have rows to lay out. Against the stubs the same ten routes are visited
 * without them.
 */

const NARROW = { width: 375, height: 812 }
const NOTE = 'Opens when the dispute and vault contracts go live.'

/** Whether the chain holds the rows of milestone two, or only the registry of the first one. */
function seeded(): boolean {
  return usesRealContracts() && modulesAreLive()
}

/** The ten routes of the application that show data. */
function routesOf(stack: Stack, seed: Seed | null): string[] {
  const targetId = seed?.dangerTargetId ?? targetIdOfContract(getAddress(stack.contract))
  const disputeId = seed?.challengeId ?? 1n
  return [
    '/app',
    `/app/t/${targetId}`,
    '/app/explore',
    '/app/disputes',
    `/app/disputes/${disputeId}`,
    '/app/bounties',
    '/app/guardians',
    `/app/g/${anvilAccount(1)}`,
    '/app/me',
    '/app/publish',
  ]
}

/** The contract of the stack has no page until someone has scanned it, so the first visitor does. */
async function scanFirst(page: Page, stack: Stack): Promise<void> {
  await page.goto('/app')
  await scanContract(page, stack.contract)
  await expect(page).toHaveURL(/\/app\/t\/0x[0-9a-f]{64}/)
}

/** Opens a route and waits until the page has stopped loading. */
async function visit(page: Page, route: string): Promise<void> {
  await page.goto(route)
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('main')).toBeVisible()
}

/** Runs a check on every route, first without a wallet and then with the wallet of an account that has activity. */
async function onEveryRoute(page: Page, routes: string[], check: (route: string, state: string) => Promise<void>): Promise<void> {
  for (const route of routes) {
    await visit(page, route)
    await check(route, 'without a wallet')
  }
  await page.goto('/app')
  await connectFromHeader(page)
  await expect(page.getByRole('banner').getByRole('button', { name: /^0x/ })).toBeVisible()
  for (const route of routes) {
    await visit(page, route)
    await check(route, 'with a wallet')
  }
}

test.describe('screens', () => {
  test.setTimeout(300_000)

  test('every app screen at 375 px has no horizontal overflow', async ({ browser, stack }, testInfo) => {
    const seed = seeded() ? await seedScreens(stack.addresses) : null
    const actor = await openActor(browser, testInfo.project.use.baseURL as string, 9)
    await actor.page.setViewportSize(NARROW)
    if (seed === null) await scanFirst(actor.page, stack)
    const routes = routesOf(stack, seed)
    expect(routes).toHaveLength(10)

    await onEveryRoute(actor.page, routes, async (route, state) => {
      const width = await actor.page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        window: window.innerWidth,
      }))
      expect(width.page, `${route} ${state}: the page is wider than the screen`).toBeLessThanOrEqual(width.window)
      expect(width.body, `${route} ${state}: the body is wider than the screen`).toBeLessThanOrEqual(width.window)
    })
    await actor.context.close()
  })

  test('every app screen passes an automated accessibility scan in both themes', async ({ browser, stack }, testInfo) => {
    const seed = seeded() ? await seedScreens(stack.addresses) : null
    const actor = await openActor(browser, testInfo.project.use.baseURL as string, 9)
    if (seed === null) await scanFirst(actor.page, stack)
    const routes = routesOf(stack, seed)

    // Every screen is scanned before the test judges, so one report names all of them.
    const found: string[] = []
    for (const theme of ['dark', 'light'] as const) {
      await actor.page.goto('/app')
      if (theme === 'light') await actor.page.getByLabel('Light theme').check()
      await expect(actor.page.locator('html')).toHaveAttribute('data-theme', theme)
      await onEveryRoute(actor.page, routes, async (route, state) => {
        // A full load starts dark again, so the theme is set on every page.
        if (theme === 'light') await actor.page.getByLabel('Light theme').check()
        // A colour that is still fading between the themes is measured half way, so the
        // transitions are switched off before the scan reads the page.
        await actor.page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
        const result = await new AxeBuilder({ page: actor.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
        for (const item of result.violations) {
          const where = item.nodes
            .slice(0, 3)
            .map(node => {
              // The contrast check names the colours and the ratio it measured.
              const data = (node.any[0]?.data ?? {}) as { fgColor?: string; bgColor?: string; contrastRatio?: number }
              const measured = data.fgColor === undefined ? '' : ` ${data.fgColor} on ${data.bgColor} = ${data.contrastRatio}`
              return `${node.target.join(' ')}${measured}`
            })
            .join(' | ')
          found.push(`${theme} ${state} ${route}: ${item.id} on ${item.nodes.length} (${where})`)
        }
      })
    }
    expect(found).toEqual([])
    await actor.context.close()
  })

  test('with modulesLive off, dispute, bounty and bond actions are disabled everywhere', async ({ browser, stack }) => {
    const seed = seeded() ? await seedScreens(stack.addresses) : null
    const closed = offUrl()
    const targetId = seed?.bountyTargetId ?? targetIdOfContract(getAddress(stack.contract))

    // The target page: the challenge and the bounty are closed, and the page says why.
    const holder = await openActor(browser, closed, 2)
    if (seed === null) await scanFirst(holder.page, stack)
    await visit(holder.page, `/app/t/${targetId}`)
    await connectFromHeader(holder.page)
    await expect(holder.page.getByRole('button', { name: 'Open a challenge' })).toBeDisabled()
    await expect(holder.page.getByRole('button', { name: 'Fund an audit bounty' })).toBeDisabled()
    await expect(holder.page.getByText(NOTE).first()).toBeVisible()
    if (seed !== null) {
      await holder.page.getByRole('tab', { name: 'Bounty' }).click()
      await expect(holder.page.getByText(NOTE).first()).toBeVisible()
      await expect(holder.page.getByRole('button', { name: 'Settle' })).toHaveCount(0)
    }

    // The lists and the page of a dispute hold nothing to act on.
    for (const route of ['/app/disputes', `/app/disputes/${seed?.challengeId ?? 1n}`, '/app/bounties']) {
      await visit(holder.page, route)
      await expect(holder.page.getByText(NOTE).first(), route).toBeVisible()
      for (const name of ['Join the jury', 'Reveal my vote', 'Resolve', 'Expire', 'Create bounty']) {
        await expect(holder.page.getByRole('button', { name }), `${route} ${name}`).toHaveCount(0)
      }
    }
    await holder.context.close()
    if (seed === null) return

    // The bond of a sponsor: the deposit is closed, and the page says why.
    const sponsor = await openActor(browser, closed, 8)
    await visit(sponsor.page, `/app/t/${seed.sponsoredTargetId}`)
    await connectFromHeader(sponsor.page)
    await sponsor.page.getByRole('tab', { name: 'Publisher' }).click()
    await expect(sponsor.page.getByRole('button', { name: 'Deposit bond' })).toBeDisabled()
    await expect(sponsor.page.getByText(NOTE).first()).toBeVisible()
    await sponsor.context.close()

    // My activity: the vault balance cannot be withdrawn, and the penalty cannot be applied.
    const credited = await openActor(browser, closed, 9)
    await visit(credited.page, '/app/me')
    await connectFromHeader(credited.page)
    await expect(credited.page.getByRole('button', { name: 'Withdraw', exact: true })).toBeDisabled()
    await expect(credited.page.getByText(NOTE).first()).toBeVisible()
    await credited.context.close()

    const penalised = await openActor(browser, closed, 6)
    await visit(penalised.page, '/app/me')
    await connectFromHeader(penalised.page)
    await expect(penalised.page.getByRole('button', { name: 'Apply penalties' })).toBeDisabled()
    await penalised.context.close()
  })
})
