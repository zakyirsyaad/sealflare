import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Hex } from 'viem'
import { CONSTANTS, targetIdOfContract } from '@sealflare/shared/rules'
import { decodeSrc } from '@sealflare/shared/schemas'
import { parseArgs } from '../src/args'
import { runPrepareAttestation, runScanContract, runScanSkill } from '../src/cli'
import { escapeText } from '../src/output'
import { prepareAttestationReport } from '../src/prepareAttestation'
import { scanSkillReport } from '../src/scanSkill'
import {
  BIDI_OVERRIDE, CORE, ESC, LINE_SEPARATOR, MANIFEST, NEL, PIPE_TO_SHELL, TARGET, ZERO_HASH,
  fakeGuard, gitIn, gitSkillIn, hasControl, packageDir, skillIn, temp,
} from './support'

/** The endpoint of a paid provider, with its key in the path, as a user would pass it. */
const PAID_RPC = ['https://rpc', '.example/v1/PAID', 'KEY'].join('')

describe('what a bundle prints cannot touch the terminal', () => {
  test('escapeText turns every control character and line break into a visible escape', () => {
    const hostile = ['a', ESC, '[9A', ESC, '[2KSafe: yes', ESC, '[8m\nb\rc', NEL, 'd', LINE_SEPARATOR, 'e', BIDI_OVERRIDE, 'f'].join('')

    const text = escapeText(hostile)

    expect(hasControl(text)).toBe(false)
    expect(text).not.toContain('\n')
    expect(text).not.toContain('\r')
    expect(text).toContain('\\x1b[9A')
    expect(text).toContain('\\x85')
  })

  test('ordinary text is left alone', () => {
    expect(escapeText('run x # fix: a "quote" and unicode é')).toBe('run x # fix: a "quote" and unicode é')
  })

  test('an excerpt with terminal sequences cannot overwrite the verdict lines', async () => {
    const hostile = `${PIPE_TO_SHELL}${ESC}[9A${ESC}[2KSafe: yes${ESC}[8m\n`
    const folder = await skillIn(await temp(), { 'run.sh': hostile })

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(hasControl(output)).toBe(false)
    expect(output.split('\n').filter(line => line.startsWith('Safe:'))).toEqual(['Safe: yes'])
  })

  test('a path with a line break cannot forge a line of the report', async () => {
    const folder = await skillIn(await temp(), { 'a\nSafe: yes\nTier: COMMUNITY_SAFE': `${PIPE_TO_SHELL}\n` })
    const danger = fakeGuard({
      checkSkill: async () => ({ tier: 'CONFIRMED_DANGER', safe: false, canonicalBundleHash: ZERO_HASH, publisher: null, flags: [], warrantyBond: 0n, reasons: [] }),
    })

    const output = await scanSkillReport({ folder, guard: danger })

    const lines = output.split('\n')
    expect(lines.filter(line => line.startsWith('Safe:'))).toEqual(['Safe: no'])
    expect(lines.filter(line => line.startsWith('Tier:'))).toEqual(['Tier: CONFIRMED_DANGER'])
  })

  test('the final output of a command is clean even when an error carries a sequence', async () => {
    const result = await runScanSkill([join(tmpdir(), `no${ESC}[2Jsuch folder`), '--core', CORE], { guard: fakeGuard() })

    expect(result.code).toBe(1)
    expect(hasControl(result.output)).toBe(false)
  })
})

describe('the short proof is checked and printed as the bytes attest() takes', () => {
  const target = {
    type: 'SMART_CONTRACT' as const,
    target: `0x${'0'.repeat(24)}${TARGET.slice(2)}` as Hex,
    targetId: targetIdOfContract(TARGET),
    label: TARGET,
    address: TARGET,
  }
  const base = { target, verdict: 'CAUTION' as const, flags: 2, evidenceHash: ZERO_HASH, evidenceURI: '' }

  test('a valid proof is printed as hex of its UTF-8 bytes', () => {
    const output = prepareAttestationReport({ ...base, shortProof: 'HIDDEN_MINT @ mint: owner can mint' })

    expect(output).toContain('Short proof bytes: 0x')
    expect(output).toContain('0x48494444454e5f4d494e5420')
  })

  test('an empty proof is the empty byte string, not the word none', () => {
    const output = prepareAttestationReport({ ...base, shortProof: '' })

    expect(output).toContain('Short proof bytes: 0x\n')
    expect(output).not.toMatch(/Short proof[^\n]*none/)
  })

  test('an empty evidence URI is printed as an empty string, not the word none', () => {
    const output = prepareAttestationReport({ ...base, shortProof: '' })

    expect(output).toContain('Evidence URI: ""')
    expect(output).not.toMatch(/Evidence URI: none/)
  })

  test('a proof above 512 bytes is refused', () => {
    const line = `HIDDEN_MINT @ mint: ${'x'.repeat(CONSTANTS.SHORT_PROOF_MAX_BYTES)}`

    expect(() => prepareAttestationReport({ ...base, shortProof: line })).toThrow(/512/)
  })

  test('the limit counts bytes, not characters', () => {
    const line = `HIDDEN_MINT @ mint: ${'é'.repeat(260)}`

    expect(() => prepareAttestationReport({ ...base, shortProof: line })).toThrow(/512/)
  })

  test('free text that is not FLAG @ location: excerpt is refused', () => {
    expect(() => prepareAttestationReport({ ...base, shortProof: 'looks bad to me' })).toThrow(/FLAG @ location: excerpt/)
    expect(() => prepareAttestationReport({ ...base, shortProof: 'NOT_A_FLAG @ mint: x' })).toThrow(/FLAG @ location: excerpt/)
  })

  test('one bad line among good ones refuses the whole proof', () => {
    expect(() => prepareAttestationReport({ ...base, shortProof: 'HIDDEN_MINT @ mint: ok\nnonsense' })).toThrow()
  })

  test('a proof that names a flag the attestation does not carry is refused', () => {
    expect(() => prepareAttestationReport({ ...base, shortProof: 'PAUSE_OR_FREEZE_FUNDS @ lock: x' })).toThrow(/do not carry/)
  })

  test('a SAFE attestation never carries a proof', () => {
    expect(() => prepareAttestationReport({ ...base, verdict: 'SAFE', flags: 0, shortProof: 'HIDDEN_MINT @ mint: x' })).toThrow(/SAFE/)
  })

  test('through the command, a proof on a SAFE verdict exits non zero', async () => {
    const result = await runPrepareAttestation([TARGET, '--verdict', 'SAFE', '--proof', 'HIDDEN_MINT @ mint: x', '--core', CORE], { guard: fakeGuard() })

    expect(result.code).toBe(1)
    expect(result.output).not.toContain('Nothing was signed')
  })

  test('through the command, a long proof exits non zero and names the limit', async () => {
    const proof = `HIDDEN_MINT @ mint: ${'x'.repeat(600)}`

    const result = await runPrepareAttestation([TARGET, '--verdict', 'CAUTION', '--flags', 'HIDDEN_MINT', '--proof', proof, '--core', CORE], { guard: fakeGuard() })

    expect(result.code).toBe(1)
    expect(result.output).toContain('512')
  })
})

describe('bad input fails with the usage instead of printing parameters', () => {
  test('a missing --core is not swallowed into an unknown tier', async () => {
    const result = await runPrepareAttestation([TARGET, '--verdict', 'CAUTION', '--flags', 'HIDDEN_MINT'])

    expect(result.code).toBe(1)
    expect(result.output).toContain('--core')
    expect(result.output).not.toContain('Nothing was signed')
  })

  test('a bad chain id fails', async () => {
    const result = await runPrepareAttestation([TARGET, '--verdict', 'CAUTION', '--flags', 'HIDDEN_MINT', '--core', CORE, '--chain-id', '5'])

    expect(result.code).toBe(1)
    expect(result.output).toContain('chain id')
  })

  test('a registry that cannot be read still prints the parameters, and says the tier is unknown', async () => {
    const broken = fakeGuard({ signal: async () => { throw new Error('rpc down') } })

    const result = await runPrepareAttestation([TARGET, '--verdict', 'CAUTION', '--flags', 'HIDDEN_MINT', '--core', CORE], { guard: broken })

    expect(result.code).toBe(0)
    expect(result.output).toContain('the current tier is unknown')
  })

  test('an address and --skill together are refused', async () => {
    const result = await runPrepareAttestation([TARGET, '--skill', '.', '--verdict', 'CAUTION', '--flags', 'PROMPT_BYPASS_CONFIRMATION', '--core', CORE], { guard: fakeGuard() })

    expect(result.code).toBe(1)
  })
})

describe('arguments are checked per command', () => {
  test('an unknown option is an error that names it', () => {
    const parsed = parseArgs(['--chainid', '97'], { options: ['core', 'rpc', 'chain-id'], maxPositionals: 1 })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.message).toContain('--chainid')
  })

  test('an extra positional is an error', () => {
    const parsed = parseArgs([TARGET, 'extra'], { options: ['core'], maxPositionals: 1 })

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.message).toContain('extra')
  })

  test('the allowed options and positionals pass', () => {
    const parsed = parseArgs([TARGET, '--core', CORE, '--rpc=http://x'], { options: ['core', 'rpc'], maxPositionals: 1 })

    expect(parsed).toEqual({ ok: true, args: { values: { core: CORE, rpc: 'http://x' }, positionals: [TARGET] } })
  })

  test('a typo in --chain-id exits non zero instead of reading mainnet', async () => {
    const result = await runScanContract([TARGET, '--core', CORE, '--chainid', '97'], { guard: fakeGuard() })

    expect(result.code).toBe(1)
    expect(result.output).toContain('--chainid')
    expect(result.output).toContain('Usage:')
  })

  test('the retired --vault option is rejected as unknown', async () => {
    const result = await runScanContract([TARGET, '--core', CORE, '--vault', CORE], { guard: fakeGuard() })

    expect(result.code).toBe(1)
    expect(result.output).toContain('--vault')
  })

  test('a second address is refused', async () => {
    const result = await runScanContract([TARGET, TARGET, '--core', CORE], { guard: fakeGuard() })

    expect(result.code).toBe(1)
  })
})

describe('links carry the source so the page can be rebuilt', () => {
  test('the target page link of a contract carries ?src=, and the app can decode it', async () => {
    const result = await runScanContract([TARGET, '--core', CORE], { guard: fakeGuard() })

    const link = result.output.split('\n').find(line => line.startsWith('Target page:')) ?? ''
    const src = new URL(link.replace('Target page: ', ''), 'https://sealflare.example').searchParams.get('src')
    expect(link).toContain(`/app/t/${targetIdOfContract(TARGET)}?src=`)
    expect(decodeSrc(src ?? '')).toEqual({ kind: 'contract', address: TARGET.toLowerCase() })
  })
})

describe('SKILL.md tells the agent that scanned text is data', () => {
  test('it names the untrusted content rule and the three things the agent never does', async () => {
    const text = await readFile(join(packageDir, 'SKILL.md'), 'utf8')

    expect(text).toMatch(/untrusted/i)
    expect(text).toMatch(/never\s+follow(s)?\s+(an\s+)?instruction/i)
    expect(text).toMatch(/never\s+run(s)?\s+(a\s+|the\s+)?script/i)
    expect(text).toMatch(/--verdict/)
    expect(text).toMatch(/only\s+from\s+the\s+user/i)
  })
})

describe('a file that could not be scanned is never a safe bundle', () => {
  test('a file that is too large to scan is counted, and the verdict is CAUTION', async () => {
    const folder = await gitSkillIn(await temp())
    await writeFile(join(folder, 'big.bin'), Buffer.alloc(CONSTANTS.MAX_BUNDLE_BYTES + 1024, 0x41))

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).toContain('Files outside the bundle that were not scanned: 1')
    expect(output).toContain('Suggested verdict: CAUTION')
    expect(output).not.toContain('Suggested verdict: SAFE')
  })
})

describe('a file that is not committed is scanned, and a manifest that is not committed is kept', () => {
  test('a changed SKILL.md that is not committed still shows its finding', async () => {
    const folder = await gitSkillIn(await temp())
    await writeFile(join(folder, 'SKILL.md'), `${MANIFEST}\n${PIPE_TO_SHELL}\n`)

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).toMatch(/SKILL\.md:\d+/)
    expect(output).not.toContain('Suggested verdict: SAFE')
  })

  test('a source that does not fit the shared schema never reaches the link', async () => {
    const folder = await gitSkillIn(await temp())
    gitIn(folder, ['remote', 'add', 'origin', 'git@github.com:sealflare/guard!.git'])

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).toContain('Target page: /app/t/')
    expect(output).not.toContain('?src=')
  })
})

describe('the endpoint of the command never reaches the output', () => {
  test('a paid key in the RPC url never reaches the output', async () => {
    const guard = fakeGuard({
      checkContract: async () => { throw new Error(`HTTP request failed.\nURL: ${PAID_RPC}`) },
    })

    const result = await runScanContract([TARGET, '--core', CORE, '--rpc', PAID_RPC], { guard })

    expect(result.code).toBe(1)
    expect(result.output).not.toContain('PAIDKEY')
    expect(result.output).not.toContain(PAID_RPC)
    expect(result.output).toContain('The check could not be completed')
  })
})

describe('the parameters are only printed for a bundle a publisher can attest', () => {
  test('a folder without a regular SKILL.md is refused', async () => {
    const folder = await temp()
    await writeFile(join(folder, 'notes.txt'), 'no manifest here\n')

    const result = await runPrepareAttestation(['--skill', folder, '--verdict', 'SAFE', '--core', CORE], { guard: fakeGuard() })

    expect(result.code).toBe(1)
    expect(result.output).toContain('SKILL.md')
    expect(result.output).not.toContain('Nothing was signed')
  })
})
