import { getAddress, type Address, type Hex } from 'viem'
import { targetIdOfContract } from '@sealflare/shared/rules'
import { connectFromHeader, openActor, panelOf, withdrawFromVault, type Actor } from './actors'
import {
  ATTESTERS,
  CHALLENGER,
  JURORS,
  attestSafe,
  CHALLENGE_STAKE,
  commitOnChain,
  deployTarget,
  modulesAreLive,
  openChallengeOf,
  openChallengeOnChain,
  revealOnChain,
  vaultBalanceOf,
  waitForIndexedChallenge,
  waitForIndexedTarget,
  warp,
} from './chainTools'
import { COMMIT_WINDOW, REVEAL_WINDOW, ratedTarget } from './seed'
import { anvilAccount, connectWallet, expect, giveAgentId, scanContract, test, usesRealContracts, waitForIndexedAttestation } from './fixtures'

/**
 * The dispute flow of milestone two, against the real Core, Court and Vault.
 *
 * The votes of the Guardians are setup and go straight to the chain: the attest flow is the
 * subject of the first milestone. Everything a challenger, a juror and a visitor does to a dispute
 * goes through the app, from the open challenge to the withdrawal. The clock of the node is moved
 * by `evm_increaseTime`, the way `pnpm chain:warp` moves it.
 */

test.skip(!usesRealContracts() || !modulesAreLive(), 'The dispute needs the real contracts with the modules open.')

/** The reveal code a juror saved, as the panel showed it. */
const REVEAL_CODE = /^sf1\.\d+\.[ur]\.[0-9a-f]{64}$/

/** The challenger opens the challenge from the target page, the way a Guardian does. */
async function openChallengeInApp(challenger: Actor, targetId: Hex, court: Address): Promise<bigint> {
  const { page } = challenger
  await page.goto(`/app/t/${targetId}`)
  await page.getByRole('button', { name: 'Open a challenge' }).click()
  const panel = panelOf(page)
  await connectWallet(panel)

  await panel.getByRole('checkbox').first().check()
  await panel.getByRole('button', { name: 'Continue' }).click()

  await panel.getByLabel(/^Quote from the evidence for/).fill('delegatecall to an address the owner can change')
  await panel.getByLabel('Written explanation').fill('The code forwards every call with delegatecall to a target the owner can replace.')
  await panel.getByRole('button', { name: 'Continue' }).click()

  await panel.getByRole('button', { name: 'Sign and open the challenge' }).click()
  await expect.poll(() => openChallengeOf(court, targetId), { timeout: 60_000 }).not.toBeNull()
  const id = await openChallengeOf(court, targetId)
  if (id === null) throw new Error('The challenge is not open.')
  await waitForIndexedChallenge(id)
  return id
}

/** A juror joins from the dispute page, saves the reveal code and commits. Returns the code. */
async function joinJury(juror: Actor, id: bigint, uphold: boolean): Promise<string> {
  const { page } = juror
  await page.goto(`/app/disputes/${id}`)
  await page.getByRole('button', { name: 'Join the jury' }).click()
  const panel = panelOf(page)
  await connectWallet(panel)

  await panel.getByRole('radio', { name: uphold ? /^Uphold/ : /^Reject/ }).click()
  await panel.getByRole('button', { name: 'Continue' }).click()
  await panel.getByRole('button', { name: 'Continue' }).click()

  const code = await panel.getByLabel('Reveal code').inputValue()
  expect(code).toMatch(REVEAL_CODE)
  await panel.getByRole('button', { name: 'Copy code' }).click()
  await panel.getByRole('button', { name: 'Sign and commit' }).click()
  await expect(panel.getByText('Your vote is committed')).toBeVisible({ timeout: 60_000 })
  return code
}

/** A juror comes back in the reveal phase, and the browser still holds the code. */
async function revealVote(juror: Actor, id: bigint, expected: string): Promise<void> {
  const { page } = juror
  await page.goto(`/app/disputes/${id}`)
  await page.getByRole('button', { name: 'Reveal my vote' }).click()
  const panel = panelOf(page)
  await connectWallet(panel)
  await expect(panel.getByText('A reveal code for this vote is saved in this browser.')).toBeVisible()
  await panel.getByRole('button', { name: 'Reveal my vote' }).click()
  await expect(panel.getByText(`Your vote: ${expected}`)).toBeVisible({ timeout: 60_000 })
}

test('scan, attest, challenge, jury, verdict, withdraw', async ({ browser, stack }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL as string
  const core = getAddress(stack.addresses.core)
  const court = getAddress(stack.addresses.court)
  const agentId = getAddress(stack.addresses.agentId)
  const vault = getAddress(stack.addresses.vault)

  const challenger = await openActor(browser, baseURL, CHALLENGER)
  const jurors = await Promise.all(JURORS.map(index => openActor(browser, baseURL, index)))
  const vaultBefore = await vaultBalanceOf(vault, challenger.account)

  // A visitor scans a contract nobody rated, and three Guardians vote safe on it.
  const contract = await deployTarget(anvilAccount(0))
  await challenger.page.goto('/app')
  await scanContract(challenger.page, contract)
  await expect(challenger.page).toHaveURL(/\/app\/t\/0x[0-9a-f]{64}/)
  const targetId = targetIdOfContract(contract) as Hex
  for (const index of [...ATTESTERS, CHALLENGER]) await giveAgentId(agentId, anvilAccount(index))
  for (const index of ATTESTERS) await attestSafe(core, index, contract)
  await waitForIndexedAttestation(targetId, anvilAccount(ATTESTERS[2]))

  // The challenger opens the dispute from the page of the target.
  const id = await openChallengeInApp(challenger, targetId, court)
  await challenger.page.goto(`/app/disputes/${id}`)
  await expect(challenger.page.getByRole('heading', { level: 1 })).toContainText(`#${id}`)

  // Three jurors commit. Each saves a reveal code first, and nobody can see a direction.
  const codes: string[] = []
  for (const juror of jurors) codes.push(await joinJury(juror, id, true))
  await challenger.page.reload()
  const jury = challenger.page.getByRole('complementary', { name: 'Jury' })
  await expect(jury.getByText('3 committed')).toBeVisible()
  await expect(jury.getByText('votes stay hidden')).toBeVisible()

  // The commit window ends. Every juror reveals with the code the browser kept.
  await warp(COMMIT_WINDOW + 1)
  for (const juror of jurors) await revealVote(juror, id, 'Uphold')

  // The reveal window ends, and anyone closes the dispute.
  await warp(REVEAL_WINDOW + 1)
  await challenger.page.goto(`/app/disputes/${id}`)
  await connectFromHeader(challenger.page)
  await challenger.page.getByRole('button', { name: 'Resolve' }).click()
  await expect(challenger.page.getByText('The jury upheld the challenge, so the target is confirmed dangerous.')).toBeVisible({
    timeout: 60_000,
  })
  await waitForIndexedChallenge(id, true)

  // The target page reads Confirmed danger, and the penalties of the safe votes wait to be applied.
  await challenger.page.goto(`/app/t/${targetId}`)
  await expect(challenger.page.getByRole('heading', { name: 'Confirmed danger', exact: true })).toBeVisible()
  await challenger.page.goto(`/app/disputes/${id}`)
  await connectFromHeader(challenger.page)
  await challenger.page.getByRole('button', { name: 'Apply penalties (3 pending)' }).click()
  await expect(challenger.page.getByRole('button', { name: /^Apply penalties/ })).toHaveCount(0, { timeout: 60_000 })

  // The challenger takes the stake back out of the vault, and the balance of the wallet goes up.
  // The jurors held the whole pool, so the challenger gets the stake back and nothing more.
  await withdrawFromVault(challenger, vault, vaultBefore, CHALLENGE_STAKE)

  for (const actor of [challenger, ...jurors]) await actor.context.close()
})

test('a challenge with two reveals expires and the challenger gets 80% back', async ({ browser, stack }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL as string
  const core = getAddress(stack.addresses.core)
  const court = getAddress(stack.addresses.court)
  const agentId = getAddress(stack.addresses.agentId)
  const vault = getAddress(stack.addresses.vault)

  const challenger = await openActor(browser, baseURL, CHALLENGER)
  // One vote makes the target; the dispute and the jury are the setup of this test.
  const vaultBefore = await vaultBalanceOf(vault, challenger.account)
  const { targetId } = await ratedTarget(stack.addresses, [ATTESTERS[0]])
  await waitForIndexedTarget(targetId)
  const id = await openChallengeOnChain(court, challenger.account, targetId)
  await waitForIndexedChallenge(id)

  // Three jurors commit, and only two of them reveal, so the quorum of three is missed.
  const salts = new Map<number, Hex>()
  for (const index of JURORS) salts.set(index, await commitOnChain(court, anvilAccount(index), id, true))
  await warp(COMMIT_WINDOW + 1)
  for (const index of JURORS.slice(0, 2)) {
    await revealOnChain(court, anvilAccount(index), id, true, salts.get(index) as Hex)
  }
  await warp(REVEAL_WINDOW + 1)

  // The page offers Expire, not Resolve, and says why.
  await challenger.page.goto(`/app/disputes/${id}`)
  await connectFromHeader(challenger.page)
  await expect(challenger.page.getByRole('button', { name: 'Resolve' })).toHaveCount(0)
  await challenger.page.getByRole('button', { name: 'Expire' }).click()
  await expect(challenger.page.getByText('Fewer than 3 jurors revealed, so the challenge expired.')).toBeVisible({ timeout: 60_000 })

  // The first expiry on a target costs a fifth of the stake: 0.008 of 0.01 BNB comes back.
  await withdrawFromVault(challenger, vault, vaultBefore, (CHALLENGE_STAKE * 80n) / 100n)

  await challenger.context.close()
})
