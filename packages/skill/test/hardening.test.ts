import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Hex } from 'viem'
import { bundleIdentity, CONSTANTS, targetIdOfContract } from '@sealflare/shared/rules'
import { decodeSrc } from '@sealflare/shared/schemas'
import { parseArgs } from '../src/args'
import { readBundle } from '../src/bundle'
import { runPrepareAttestation, runScanContract, runScanSkill } from '../src/cli'
import { escapeText } from '../src/output'
import { prepareAttestationReport } from '../src/prepareAttestation'
import { scanSkillReport } from '../src/scanSkill'
import {
  BIDI_OVERRIDE, CORE, ESC, LINE_SEPARATOR, MANIFEST, NEL, PIPE_TO_SHELL, TARGET, ZERO_HASH,
  fakeGuard, gitIn, gitSkillIn, hasControl, packageDir, skillIn, temp,
} from './support'

describe('the bundle is read the way the registry reads it', () => {
  test('folders that used to be skipped are hashed and scanned', async () => {
    const folder = await skillIn(await temp(), {
      'dist/postinstall.sh': `${PIPE_TO_SHELL}\n`,
      'node_modules/dep/index.js': 'module.exports = 1\n',
      '.next/build.js': 'export const built = true\n',
      'test-results/log.txt': 'a log\n',
    })

    const entries = (await readBundle(folder)).hashed
    const paths = entries.map(entry => entry.path)

    for (const path of ['dist/postinstall.sh', 'node_modules/dep/index.js', '.next/build.js', 'test-results/log.txt']) {
      expect(paths).toContain(path)
    }
    const clean = await skillIn(await temp())
    expect(bundleIdentity(entries).canonicalBundleHash).not.toBe(bundleIdentity((await readBundle(clean)).hashed).canonicalBundleHash)
  })

  test('a skill with a hidden dist script is not suggested as safe', async () => {
    const folder = await skillIn(await temp(), { 'dist/postinstall.sh': `${PIPE_TO_SHELL}\n` })

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).not.toContain('Suggested verdict: SAFE')
    expect(output).toContain('dist/postinstall.sh')
  })

  test('only the git metadata folder is left out, because a git tree can never hold one', async () => {
    const folder = await skillIn(await temp(), { '.git/config': '[core]\n' })

    const paths = ((await readBundle(folder)).hashed).map(entry => entry.path)

    expect(paths).toEqual(['SKILL.md'])
  })

  test('publisher.sig is read, so the hash can leave it out the way the registry does', async () => {
    const folder = await skillIn(await temp(), { 'publisher.sig': '0xabc\n' })

    const entries = (await readBundle(folder)).hashed

    expect(entries.map(entry => entry.path)).toContain('publisher.sig')
    expect(bundleIdentity(entries).canonicalBundleHash).toBe(bundleIdentity((await readBundle(await skillIn(await temp()))).hashed).canonicalBundleHash)
  })

  test('a link is read as the text of its target and never followed', async () => {
    const folder = await skillIn(await temp())
    await symlink('/etc/hosts', join(folder, 'hosts'))

    const entry = ((await readBundle(folder)).hashed).find(item => item.path === 'hosts')

    expect(entry?.kind).toBe('symlink')
    expect(new TextDecoder().decode(entry?.bytes)).toBe('/etc/hosts')
  })

  test('a folder with too many files fails instead of being cut short', async () => {
    const folder = await skillIn(await temp())
    for (let index = 0; index <= CONSTANTS.MAX_BUNDLE_FILES; index += 1) await writeFile(join(folder, `f${index}.txt`), 'x')

    await expect(readBundle(folder)).rejects.toThrow(/more than 200 files/)
  })

  test('the signature does not count towards the limit, because the registry leaves it out too', async () => {
    const folder = await skillIn(await temp(), { 'publisher.sig': '0xabc\n' })
    for (let index = 0; index < CONSTANTS.MAX_BUNDLE_FILES - 2; index += 1) await writeFile(join(folder, `f${index}.txt`), 'x')
    await writeFile(join(folder, 'zz.txt'), 'x')

    const bundle = await readBundle(folder)

    expect(bundle.hashed.length).toBe(CONSTANTS.MAX_BUNDLE_FILES + 1)
  })
})

describe('a git work tree is hashed the way the registry hashes the tree of a repository', () => {
  test('only the committed files are part of the bundle', async () => {
    const folder = await gitSkillIn(await temp(), { 'dist/postinstall.sh': `${PIPE_TO_SHELL}\n` })

    const bundle = await readBundle(folder)

    expect(bundle.hashed.map(entry => entry.path)).toEqual(['SKILL.md'])
    expect(bundle.extra.map(entry => entry.path)).toEqual(['dist/postinstall.sh'])
  })

  test('a file that is not committed never changes the hash or the target id', async () => {
    const folder = await gitSkillIn(await temp(), { 'local.txt': 'not committed\n' })
    const clean = await gitSkillIn(await temp())

    const bundle = await readBundle(folder)

    expect(bundleIdentity(bundle.hashed).canonicalBundleHash).toBe(
      bundleIdentity((await readBundle(clean)).hashed).canonicalBundleHash,
    )
  })

  test('a file that is only staged is not part of the bundle, because the registry hashes the commit', async () => {
    const folder = await gitSkillIn(await temp())
    await writeFile(join(folder, 'staged.txt'), 'staged only\n')
    gitIn(folder, ['add', '--', 'staged.txt'])

    const bundle = await readBundle(folder)

    expect(bundle.hashed.map(entry => entry.path)).toEqual(['SKILL.md'])
    expect(bundle.extra.map(entry => entry.path)).toEqual(['staged.txt'])
  })

  test('a local change to a committed file never changes the hash, but it is still scanned', async () => {
    const folder = await gitSkillIn(await temp())
    await writeFile(join(folder, 'SKILL.md'), `${MANIFEST}\n${PIPE_TO_SHELL}\n`)
    const clean = await gitSkillIn(await temp())

    const bundle = await readBundle(folder)

    expect(bundleIdentity(bundle.hashed).canonicalBundleHash).toBe(
      bundleIdentity((await readBundle(clean)).hashed).canonicalBundleHash,
    )
    expect(bundle.extra.map(entry => entry.path)).toEqual(['SKILL.md'])
  })

  test('a file that is not committed is still scanned, so its finding is shown', async () => {
    const folder = await gitSkillIn(await temp(), { 'dist/postinstall.sh': `${PIPE_TO_SHELL}\n` })

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).toContain('dist/postinstall.sh')
    expect(output).not.toContain('Suggested verdict: SAFE')
  })

  test('a work tree with more files than a bundle may hold still scans', async () => {
    const folder = await gitSkillIn(await temp())
    for (let index = 0; index < CONSTANTS.MAX_BUNDLE_FILES + 20; index += 1) {
      await mkdir(join(folder, 'node_modules', `dep${index}`), { recursive: true })
      await writeFile(join(folder, 'node_modules', `dep${index}`, 'index.js'), 'module.exports = 1\n')
    }

    const output = await scanSkillReport({ folder, guard: fakeGuard() })

    expect(output).toContain('Files in the bundle: 1')
    expect(output).toContain('Suggested verdict:')
  })

  test('a file that is not committed is read before an ignored dependency tree', async () => {
    const folder = await gitSkillIn(await temp(), { 'node_modules/dep/index.js': 'module.exports = 1\n' })
    await writeFile(join(folder, '.gitignore'), 'node_modules/\n')
    gitIn(folder, ['add', '--', '.gitignore'])
    gitIn(folder, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'ignore'])
    await writeFile(join(folder, 'payload.sh'), `${PIPE_TO_SHELL}\n`)

    const bundle = await readBundle(folder)

    expect(bundle.extra[0]?.path).toBe('payload.sh')
  })

  test('the file monitor of the repository is never run', async () => {
    const folder = await gitSkillIn(await temp())
    const marker = join(folder, 'monitor-ran')
    const script = join(folder, 'monitor.sh')
    await writeFile(script, `#!/bin/sh\ntouch ${marker}\n`)
    await chmod(script, 0o755)
    await writeFile(join(folder, '.git', 'config'), `[core]\n\tfsmonitor = ${script}\n`)

    await readBundle(folder)

    expect(existsSync(marker)).toBe(false)
  })

  test('a repository that git will not work with is an error, not a folder outside git', async () => {
    const folder = await gitSkillIn(await temp())
    await writeFile(join(folder, '.git', 'config'), 'this is not a config\n')

    await expect(readBundle(folder)).rejects.toThrow(/git will not work with/)
  })

  test('a folder inside a git repository with no committed file has no bundle to hash', async () => {
    const folder = await skillIn(await temp(), { 'a.txt': 'x\n' })
    execFileSync('git', ['init', '-q'], { cwd: folder })

    await expect(readBundle(folder)).rejects.toThrow(/no commit yet/)
  })
})

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
