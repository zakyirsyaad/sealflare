/**
 * Writes the `expected` block of every bundle fixture and regenerates rules/vectors/ids.json.
 * Run only when the hash rule itself changes: these values are a frozen agreement.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Address, type Hex, hexToBytes } from 'viem'
import { ZERO_ADDRESS, canonicalBundleHash, contentHash, targetIdOfContract, targetIdOfSkill } from '../rules'

const dir = fileURLToPath(new URL('../fixtures/bundles/', import.meta.url))
const write = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

const skills = readdirSync(dir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => {
    const fixture = JSON.parse(readFileSync(dir + name, 'utf8')) as {
      entries: { path: string; kind: 'file' | 'symlink'; hex: Hex }[]
      manifestPublisher: Address
    }
    const content = contentHash(fixture.entries.map((e) => ({ path: e.path, kind: e.kind, bytes: hexToBytes(e.hex) })))
    const canonical = canonicalBundleHash(content, fixture.manifestPublisher)
    const expected = { contentHash: content, canonicalBundleHash: canonical, targetId: targetIdOfSkill(canonical) }
    write(dir + name, { ...fixture, expected })
    return { fixture: name.replace('.json', ''), publisher: fixture.manifestPublisher, ...expected }
  })

const contracts = [
  ZERO_ADDRESS,
  '0x60b9262456de011f7d15a54cdd8c48baaa8b022f',
  '0xffffffffffffffffffffffffffffffffffffffff',
].map((address) => ({ address, targetId: targetIdOfContract(address as Address) }))

write(fileURLToPath(new URL('../rules/vectors/ids.json', import.meta.url)), { contracts, skills })
