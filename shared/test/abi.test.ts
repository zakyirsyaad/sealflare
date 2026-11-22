import { expect, test } from 'vitest'
import { keccak256, toBytes } from 'viem'
import { EIP712, coreAbi, courtAbi, firewallAbi, vaultAbi } from '../abi'
import eip712Vectors from '../rules/vectors/eip712.json'

type AbiItem = { type: string; name?: string; inputs?: readonly { name?: string }[] }
const names = (abi: readonly AbiItem[], type: string) => abi.filter((x) => x.type === type).map((x) => x.name)

test('every Core function the app calls exists in the ABI', () => {
  expect(names(coreAbi, 'function')).toEqual(
    expect.arrayContaining([
      'attest', 'bindByOwner', 'bindByDeployer', 'bindSkill', 'sponsor', 'probeBytecode', 'settle', 'applyPenalties',
      'setModules', 'verifyContract', 'verifySkillBundle', 'tierOf', 'getTarget', 'attestationIndexOf',
      'attestationsLeftToday', 'isAgentIdHolder', 'pendingSettlement', 'pendingPenalties',
    ]),
  )
})
test('Attested carries the frozen weight and both ordinals', () => {
  const event = coreAbi.find((x) => x.type === 'event' && x.name === 'Attested') as AbiItem
  expect(event.inputs?.map((i) => i.name)).toEqual([
    'targetId', 'guardian', 'verdict', 'flags', 'weight', 'index', 'safeOrdinal', 'evidenceHash', 'shortProof', 'evidenceURI',
  ])
})
test('every score change has an event', () => {
  const event = coreAbi.find((x) => x.type === 'event' && x.name === 'ScoreChanged') as AbiItem
  expect(event.inputs?.map((i) => i.name)).toEqual(['guardian', 'targetId', 'delta', 'newScore', 'reason'])
})
test('IFirewall returns the pinned codehash, not an implementation hash', () => {
  const fn = firewallAbi.find((x) => x.type === 'function' && x.name === 'verifyContract') as unknown as {
    outputs: { name: string }[]
  }
  expect(fn.outputs.map((o) => o.name)).toEqual(['tier', 'isUpgradeableProxy', 'pinnedCodehash', 'activeFlags', 'warrantyBondActive'])
})
test('Court exposes the dispute state machine', () => {
  expect(names(courtAbi, 'function')).toEqual(
    expect.arrayContaining(['openChallenge', 'submitCounterEvidence', 'commitVote', 'revealVote', 'resolve', 'expire', 'phaseOf', 'jurorStatus', 'commitHashOf']),
  )
})
test('Vault exposes exactly four Court-only entry points next to the public ones', () => {
  expect(names(vaultAbi, 'function').sort()).toEqual(
    [
      'activeBond', 'balanceOf', 'bondOf', 'core', 'createBounty', 'depositBond', 'depositStake', 'distribute', 'escrowOf',
      'finalizeBondWithdrawal', 'getBounty', 'lockBond', 'requestBondWithdrawal', 'settleBond', 'settleBounty', 'treasury', 'withdraw',
    ].sort(),
  )
})
test('Vault has no receive or fallback entry', () => {
  expect(vaultAbi.some((x: AbiItem) => x.type === 'receive' || x.type === 'fallback')).toBe(false)
})
test('only the functions that take BNB are payable', () => {
  const payable = (abi: readonly (AbiItem & { stateMutability?: string })[]) =>
    abi.filter((x) => x.type === 'function' && x.stateMutability === 'payable').map((x) => x.name).sort()
  expect(payable(coreAbi)).toEqual([])
  expect(payable(courtAbi)).toEqual(['commitVote', 'openChallenge'])
  expect(payable(vaultAbi)).toEqual(['createBounty', 'depositBond', 'depositStake'])
})
test('custom errors are part of the exported ABIs', () => {
  expect(names(coreAbi, 'error')).toEqual(expect.arrayContaining(['DailyLimitReached', 'NotAgentIdHolder', 'AlreadyAttested', 'ModulesAlreadySet']))
  expect(names(courtAbi, 'error')).toEqual(expect.arrayContaining(['NotEligibleJuror', 'WrongPhase', 'InCooldown']))
  expect(names(vaultAbi, 'error')).toEqual(expect.arrayContaining(['BondIsLocked', 'EscrowExceeded', 'OnlyCourt']))
})
test('no ABI declares an owner or upgrade entry point', () => {
  const all = [...names(coreAbi, 'function'), ...names(courtAbi, 'function'), ...names(vaultAbi, 'function')]
  expect(all.filter((n) => /^(owner|transferOwnership|renounceOwnership|upgrade|pause|unpause|admin)/i.test(n ?? ''))).toEqual([])
})
test('binding signatures use the frozen EIP-712 types, each with a per-target nonce against replay', () => {
  expect(EIP712.domain).toEqual({ name: 'Sealflare', version: '1' })
  expect(EIP712.types.BindByOwner.map((f) => `${f.type} ${f.name}`)).toEqual([
    'address target', 'address agentIdHolder', 'uint256 bindNonce', 'uint256 deadline',
  ])
  expect(EIP712.types.BindByDeployer.map((f) => `${f.type} ${f.name}`)).toEqual([
    'address target', 'address deployer', 'uint256 deployNonce', 'address agentIdHolder', 'uint256 bindNonce', 'uint256 deadline',
  ])
  expect(names(coreAbi, 'function')).toEqual(expect.arrayContaining(['bindNonce', 'DOMAIN_SEPARATOR']))
})
test('the EIP-712 type strings and hashes match the vector the Solidity side is tested against', () => {
  for (const [name, fields] of Object.entries(EIP712.types)) {
    const typeString = `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`
    const row = eip712Vectors[name as keyof typeof eip712Vectors]
    expect(typeString).toBe(row.typeString)
    expect(keccak256(toBytes(typeString))).toBe(row.typeHash)
  }
})
test('a settled bond names the target and the depositor', () => {
  const event = vaultAbi.find((x) => x.type === 'event' && x.name === 'BondSettled') as AbiItem
  expect(event.inputs?.map((i) => i.name)).toEqual(['challengeId', 'targetId', 'depositor', 'slashed', 'released'])
})

// ---- deferred minors ----
test('every credit to a withdrawable balance has an event', () => {
  const event = vaultAbi.find((x) => x.type === 'event' && x.name === 'BalanceCredited') as AbiItem
  expect(event.inputs?.map((i) => i.name)).toEqual(['account', 'amount'])
})
test('settleBond reports what it slashed and released', () => {
  const fn = vaultAbi.find((x) => x.type === 'function' && x.name === 'settleBond') as unknown as { outputs: { name: string }[] }
  expect(fn.outputs.map((o) => o.name)).toEqual(['slashed', 'released'])
})
test('an attestation records whether it was cast during a dispute', () => {
  const fn = coreAbi.find((x) => x.type === 'function' && x.name === 'getAttestation') as unknown as {
    outputs: { components: { name: string }[] }[]
  }
  expect(fn.outputs[0]?.components.map((c) => c.name)).toContain('castDuringDispute')
})
