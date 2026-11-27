import { getAddress, parseEther, type Hex } from 'viem'
import { targetIdOfContract } from '@sealflare/shared/rules'
import { alignClockWithChain, connectFromHeader, openActor, withdrawFromVault } from './actors'
import { bondOf, deployTarget, modulesAreLive, vaultBalanceOf, waitForIndexedTarget, warp } from './chainTools'
import { anvilAccount, expect, giveAgentId, test, usesRealContracts } from './fixtures'

/**
 * The Publish flow and the warranty bond of milestone two, against the real Core and Vault.
 *
 * The publisher deploys a contract that has no owner, so the deployer proves it: the wallet signs
 * once with no gas, and the transaction that binds follows. The bond goes to the vault, the
 * withdrawal is requested, the clock of the node moves seven days, and the withdrawal is finalized.
 */

test.skip(!usesRealContracts() || !modulesAreLive(), 'The bond needs the real contracts with the modules open.')

/** The account of the local node that publishes. The seed script gave it an Agent ID. */
const PUBLISHER = 4
const BOND = '0.1'
const UNBONDING = 7 * 24 * 3600

test('a publisher binds, deposits a bond, requests withdrawal and finalizes after 7 days', async ({ browser, stack }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL as string
  const vault = getAddress(stack.addresses.vault)
  await giveAgentId(getAddress(stack.addresses.agentId), anvilAccount(PUBLISHER))
  const publisher = await openActor(browser, baseURL, PUBLISHER)
  const { page, account } = publisher
  // The node has moved its clock in earlier tests, and the request to bind carries a deadline.
  await alignClockWithChain(page)
  const contract = await deployTarget(account)
  const targetId = targetIdOfContract(contract) as Hex

  // The publisher names the contract, and the page finds that it has no owner.
  await page.goto('/app/publish')
  await connectFromHeader(page)
  await page.getByLabel('Contract address', { exact: true }).fill(contract)
  await page.getByRole('button', { name: 'Check ownership' }).click()
  await expect(page.getByText('This contract has no owner. Enter the address that deployed it.')).toBeVisible()

  // The deployer is the connected wallet, so it signs once and binds.
  await page.getByLabel('Deployer address').fill(account)
  await page.getByRole('button', { name: 'Find the deployment nonce' }).click()
  await page.getByRole('button', { name: 'Prove you own it' }).click()
  await expect(page.getByText('You deployed this contract. Sign once, with no gas, to name your Agent ID as the publisher.')).toBeVisible()
  await page.getByRole('button', { name: 'Sign and bind' }).click()

  // The bond is the next step. The terms come from the contract constants.
  await expect(page.getByText(/^Up to 0\.5 BNB\. It takes 7 days to withdraw/)).toBeVisible({ timeout: 60_000 })
  await page.getByLabel('Amount in BNB').fill(BOND)
  await page.getByRole('button', { name: 'Deposit bond' }).click()
  await expect(page.getByRole('button', { name: 'Copy the snippet' })).toBeVisible({ timeout: 60_000 })
  expect((await bondOf(vault, targetId, account)).amount).toBe(parseEther(BOND))

  // The Publisher tab shows the bond, and the publisher asks to take it out.
  await waitForIndexedTarget(targetId)
  await page.goto(`/app/t/${targetId}`)
  await connectFromHeader(page)
  await page.getByRole('tab', { name: 'Publisher' }).click()
  await expect(page.getByText(`Your bond: ${BOND} BNB`)).toBeVisible()
  await page.getByRole('button', { name: 'Request withdrawal' }).click()
  await expect(page.getByText(/^The withdrawal was requested\. It becomes available at/).first()).toBeVisible({ timeout: 60_000 })
  expect((await bondOf(vault, targetId, account)).withdrawalAvailableAt).toBeGreaterThan(0n)

  // Seven days pass on the node. The panel judges the wait by the clock of the browser, so the
  // browser is given the time of the node.
  await warp(UNBONDING + 1)
  await alignClockWithChain(page)
  await page.reload()
  await connectFromHeader(page)
  await page.getByRole('tab', { name: 'Publisher' }).click()
  await expect(page.getByText('The bond can be withdrawn now.').first()).toBeVisible()

  // The vault pays by pull: finalizing moves the bond to the balance of the publisher, and the
  // balance is taken out from My activity.
  const vaultBefore = await vaultBalanceOf(vault, account)
  await page.getByRole('button', { name: 'Finalize withdrawal' }).click()
  await expect.poll(async () => (await bondOf(vault, targetId, account)).amount, { timeout: 60_000 }).toBe(0n)
  await withdrawFromVault(publisher, vault, vaultBefore, parseEther(BOND))

  await publisher.context.close()
})
