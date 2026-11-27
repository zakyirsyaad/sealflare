import {
  SECOND_HOLDER,
  WITHOUT_AGENT_ID,
  anvilAccount,
  collectErrors,
  connectWallet,
  expect,
  giveAgentId,
  mineBlocks,
  nameAccount,
  removeAgentId,
  scanContract,
  test,
  useAllAttestations,
  usesRealContracts,
  waitForIndexedAttestation,
} from './fixtures'
import { getAddress } from 'viem'

/**
 * The scan and the attest flow of milestone one.
 *
 * The suite runs against the stack the harness starts: the stub contracts on a local chain, the
 * indexer, the internal service and the web app with the mock scanner. The wallet is a connector
 * of the suite: it holds no key and asks the local node to sign with the account it has unlocked.
 */

/** The column of the actions of the target page. */
function actions(page: import('@playwright/test').Page) {
  return page.getByRole('complementary', { name: 'Attest' })
}

/** The panel of the attest, which is a dialog of its own. */
function panel(page: import('@playwright/test').Page) {
  return page.locator('dialog.sf-panel')
}

/** The id of the target the page shows. */
function targetIdOf(page: import('@playwright/test').Page): string {
  const id = new URL(page.url()).pathname.split('/').pop()
  if (id === undefined) throw new Error('The page is not a target page.')
  return id
}

test('a visitor scans a contract and reads the result without a wallet', async ({ page, stack }) => {
  const errors = collectErrors(page)
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Scan', exact: true })).toBeVisible()

  await scanContract(page, stack.contract)

  await expect(page).toHaveURL(/\/app\/t\/0x[0-9a-f]{64}/)
  const label = `${stack.contract.slice(0, 6)}…${stack.contract.slice(-4)}`.toLowerCase()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(label)
  await expect(page.getByText('Smart contract', { exact: true })).toBeVisible()

  // The registry has never rated this contract, so it says so instead of guessing a verdict.
  await expect(page.getByRole('heading', { name: 'Unrated', exact: true })).toBeVisible()
  await expect(page.getByText('There is not enough community signal to assign a safe verdict.')).toBeVisible()

  // The findings of the scan are on the page.
  await expect(page.getByText('Source code is verified on the explorer')).toBeVisible()
  await expect(page.getByText('Transfer dry run')).toBeVisible()

  // No wallet was asked for, and none was needed.
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible()
  expect(errors).toEqual([])
})

test('a new Guardian scans, attests and sees the vote after the block is final', async ({ page, stack, wallet }) => {
  const errors = collectErrors(page)
  await page.goto('/app')
  await scanContract(page, stack.contract)
  await expect(page).toHaveURL(/\/app\/t\/0x[0-9a-f]{64}/)
  const targetId = targetIdOf(page)

  // The panel asks for a wallet first, because nothing can be signed without one.
  await actions(page).getByRole('button', { name: 'Attest', exact: true }).click()
  await expect(panel(page)).toBeVisible()
  await connectWallet(panel(page))

  // The first step is the verdict, and the scanner only suggests.
  const choices = panel(page).getByRole('radiogroup', { name: 'Your verdict' })
  await expect(choices).toBeVisible()
  await panel(page).getByRole('radio', { name: /^Safe/ }).click()
  await panel(page).getByRole('button', { name: 'Review' }).click()

  // The second step names what goes on-chain, and the vote waits for the two approvals.
  await expect(panel(page).getByText('What goes on-chain')).toBeVisible()
  await panel(page).getByRole('button', { name: 'Sign and attest' }).click()

  // The first approval signs the evidence, the second one sends the transaction. The vote is on
  // the chain, but the indexer reads it only when the block is closed. The label of the app says
  // "finality", because that is what a public chain gives. A local node has none: it answers
  // the final block with the genesis block, so the indexer of the suite reads up to the tip.
  await expect(panel(page).getByText('Waiting for finality')).toBeVisible({ timeout: 60_000 })

  // The block of the vote is closed, and the indexer reads it.
  await mineBlocks(3)
  await waitForIndexedAttestation(targetId, wallet.account)

  await page.reload()
  await page.getByRole('tab', { name: /Attestations/ }).click()
  const row = page.getByRole('row').filter({ hasText: `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` })
  await expect(row).toBeVisible()
  await expect(row.getByText('Safe', { exact: true })).toBeVisible()
  // A safe vote carries no flag, so the row has no flag label.
  await expect(row.getByText('None', { exact: true })).toBeVisible()
  // The evidence of the vote is pinned, so the row links to the report.
  await expect(row.getByRole('link', { name: 'Evidence' })).toHaveAttribute('href', /^ipfs:\/\//)

  expect(errors).toEqual([])
})

test('an account without an Agent ID is offered both paths and can continue after getting one', async ({ page, stack }) => {
  const errors = collectErrors(page)
  const account = anvilAccount(WITHOUT_AGENT_ID)
  // A second round of the suite finds an account that has an ID, so it is taken away first.
  await removeAgentId(getAddress(stack.addresses.agentId), account)
  await nameAccount(page, account)

  await page.goto('/app')
  await scanContract(page, stack.contract)
  await expect(page).toHaveURL(/\/app\/t\/0x[0-9a-f]{64}/)

  await actions(page).getByRole('button', { name: 'Attest', exact: true }).click()
  await expect(panel(page)).toBeVisible()
  await connectWallet(panel(page))

  // The wallet is connected, but it holds no Agent ID, so both ways out are offered.
  await expect(panel(page).getByRole('heading', { name: 'You need an Agent ID.' })).toBeVisible()
  await expect(panel(page).getByRole('button', { name: 'I have one on another wallet' })).toBeVisible()
  await expect(panel(page).getByRole('link', { name: 'Get an Agent ID' })).toBeVisible()

  // The Agent ID arrives, and the Guardian may vote after the check.
  await giveAgentId(getAddress(stack.addresses.agentId), account)
  await panel(page).getByRole('button', { name: 'Check again' }).click()
  await expect(panel(page).getByRole('radiogroup', { name: 'Your verdict' })).toBeVisible()

  expect(errors).toEqual([])
})

test('the sixth attestation in a day shows the daily limit sentence', async ({ page, stack }) => {
  // The stub keeps no quota of its own, so the suite sets it. The real Core keeps the quota and
  // refuses the sixth vote itself, which the founder checks at the milestone meeting.
  test.skip(usesRealContracts(), 'The quota of the real Core cannot be set from outside.')
  const errors = collectErrors(page)
  const account = anvilAccount(SECOND_HOLDER)
  await nameAccount(page, account)

  await page.goto('/app')
  await scanContract(page, stack.contract)
  await expect(page).toHaveURL(/\/app\/t\/0x[0-9a-f]{64}/)

  // The quota of the account is used up, the way it is after five attestations.
  await useAllAttestations(getAddress(stack.addresses.core), account)

  await page.getByRole('button', { name: 'Connect wallet' }).click()
  await connectWallet(page.getByRole('dialog', { name: 'Connect a wallet' }))

  // The sixth attestation is closed, and the page says why.
  await expect(page.getByText('You have used all 5 attestations for today.')).toBeVisible()
  await expect(actions(page).getByRole('button', { name: 'Attest', exact: true })).toBeDisabled()

  expect(errors).toEqual([])
})
