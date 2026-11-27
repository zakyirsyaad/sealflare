import type { Browser, BrowserContext, Page } from '@playwright/test'
import { formatEther, type Address } from 'viem'
import { balanceOf, chainNow, vaultBalanceOf } from './chainTools'
import { WALLET_NAME, anvilAccount, expect, nameAccount } from './fixtures'

/**
 * One person of a test: a browser of their own with the account of the local node they use.
 *
 * A juror keeps their reveal code in the storage of their browser, so every juror needs a browser
 * context that lives from the commit to the reveal. A context also keeps the accounts of a test
 * apart: the wallet of the suite names the account when the page loads.
 */
export type Actor = {
  context: BrowserContext
  page: Page
  account: Address
}

/** Opens a browser for the account with the given index. The clipboard is allowed, so a reveal code can be copied. */
export async function openActor(browser: Browser, baseURL: string, index: number): Promise<Actor> {
  const context = await browser.newContext({ baseURL, permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await context.newPage()
  const account = anvilAccount(index)
  await nameAccount(page, account)
  return { context, page, account }
}

/** Connects the wallet of the suite from the button of the header. */
export async function connectFromHeader(page: Page): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'Connect wallet' }).click()
  await page.getByRole('dialog', { name: 'Connect a wallet' }).getByRole('button', { name: WALLET_NAME }).click()
}

/** The panel of an action, which is a dialog of its own. */
export function panelOf(page: Page) {
  return page.locator('dialog.sf-panel')
}

/**
 * Gives the browser the time of the local node.
 *
 * The node moves its clock forward to pass a window, and the browser does not follow. A request
 * that carries a deadline of the browser, such as the request to bind a publisher, is then already
 * late for the contract. The time stays fixed, so it is only used by a test that is about a window
 * of the chain and signs no request of the service, which wants the real time.
 */
export async function alignClockWithChain(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date((await chainNow()) * 1000))
}

/**
 * An account takes what the vault holds out, and the wallet gets it.
 *
 * Earlier rounds of the suite may have left a balance in the vault, so the test measures what the
 * step under test added: `gain` is what the contracts owe the account when it ends this way.
 */
export async function withdrawFromVault(actor: Actor, vault: Address, vaultBefore: bigint, gain: bigint): Promise<void> {
  const { page, account } = actor
  const held = await vaultBalanceOf(vault, account)
  expect(held - vaultBefore).toBe(gain)
  await page.goto('/app/me')
  await connectFromHeader(page)
  await expect(page.getByRole('region', { name: 'Balance' })).toContainText(`${formatEther(held)} BNB`)
  const walletBefore = await balanceOf(account)
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click()
  await expect.poll(() => vaultBalanceOf(vault, account), { timeout: 60_000 }).toBe(0n)
  expect(await balanceOf(account)).toBeGreaterThan(walletBefore)
}
