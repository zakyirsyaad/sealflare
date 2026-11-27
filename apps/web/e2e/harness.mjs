#!/usr/bin/env node
// The end-to-end harness of milestone one.
//
// It starts the whole stack on this machine: a Postgres database, Anvil with the stub contracts,
// the internal service, the indexer, a local storage for the evidence and the web app with the
// mock scanner. Then it runs the Playwright suite against it. Nothing reaches outside the
// machine and no secret is used.
//
//   node apps/web/e2e/harness.mjs
//
// Environment:
//   E2E_RUNS       how many times the suite runs, one after the other (default 1)
//   E2E_KEEP       keep the stack running after the suite (default 0)
//   DATABASE_URL   the database to use. A throwaway cluster is started when it is not given.
//   FOUNDRY_BIN    the directory of the Foundry programs, when they are not on the path.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startDatabase } from './harness/postgres.mjs'
import { startStorage } from './harness/storage.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const WEB = join(ROOT, 'apps/web')
const RUNS = Math.max(1, Number(process.env.E2E_RUNS ?? '1'))

const ANVIL_URL = 'http://127.0.0.1:8545'
const INTERNAL_PORT = Number(process.env.E2E_INTERNAL_PORT ?? '9999')
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? '3102')
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`
/** The key between the app and the internal service. It never leaves this machine. */
const INTERNAL_KEY = 'e2e-local-internal-key-0123456789-abcdefghij'
/** The skill target of the seed script. The indexer has read it when it answers for it. */
const SEEDED_SKILL_TARGET = '0xa01952409246800ff1ca8031688af18ac78d9218bdb89a3c62a13b2599278377'

const running = []
let database = null
let storage = null

/**
 * The Foundry programs have to be the ones of Foundry. A Node package called forge may sit on the
 * path first, and it knows nothing about scripts. The Homebrew program may also be too old for
 * the contracts, so the version is read before the directory is put in front of the path.
 */
function withFoundryOnPath() {
  const dirs = [process.env.FOUNDRY_BIN, '/opt/homebrew/bin', '/usr/local/bin', `${process.env.HOME}/.foundry/bin`]
  for (const dir of dirs) {
    if (dir === undefined || dir === '') continue
    const forge = join(dir, 'forge')
    const anvil = join(dir, 'anvil')
    if (!existsSync(forge) || !existsSync(anvil)) continue
    if (!isNewEnough(forge)) {
      process.stdout.write(`[harness] the Foundry in ${dir} is too old for the contracts.\n`)
      continue
    }
    process.env.PATH = `${dir}:${process.env.PATH ?? ''}`
    return
  }
  throw new Error(
    'Foundry 1.7.1 or newer is needed for the end-to-end suite. Install it, or point FOUNDRY_BIN at it.',
  )
}

/** Whether the Foundry program is new enough for the contracts of the repository. */
function isNewEnough(forge) {
  const result = spawnSync(forge, ['--version'], { encoding: 'utf8' })
  if (result.status !== 0) return false
  const match = /Version:\s*(\d+)\.(\d+)\.(\d+)/.exec(result.stdout ?? '')
  if (match === null) return false
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (major !== 1) return major > 1
  if (minor !== 7) return minor > 7
  return patch >= 1
}

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const write = (chunk) => {
    output += chunk.toString()
    process.stdout.write(`[${name}] ${chunk}`)
  }
  child.stdout.on('data', write)
  child.stderr.on('data', write)
  const handle = { name, child, text: () => output }
  running.push(handle)
  child.on('exit', code => {
    if (code !== 0 && !handle.stopping) process.stdout.write(`[${name}] stopped with code ${code}\n`)
  })
  return handle
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Waits until the process has written the line, or gives up. */
async function waitForLine(handle, needle, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (handle.text().includes(needle)) return
    if (handle.child.exitCode !== null) {
      throw new Error(`${handle.name} stopped before it wrote "${needle}".`)
    }
    await sleep(100)
  }
  throw new Error(`${handle.name} never wrote "${needle}".`)
}

/** Waits until the address answers, or gives up. */
async function waitForHttp(url, timeoutMs = 120_000, options = {}) {
  const deadline = Date.now() + timeoutMs
  let last = 'no answer'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000), ...options })
      if (response.status < 500) return response
      last = `status ${response.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await sleep(200)
  }
  throw new Error(`${url} did not answer: ${last}`)
}

/** Runs a command to the end and fails the whole run when it does not succeed. */
function runToEnd(name, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const handle = start(name, command, args, options)
    handle.child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${name} stopped with code ${code}.`))
    })
  })
}

async function stopAll() {
  for (const handle of running.reverse()) {
    handle.stopping = true
    handle.child.kill('SIGTERM')
  }
  await sleep(500)
  for (const handle of running) {
    if (handle.child.exitCode === null) handle.child.kill('SIGKILL')
  }
  if (storage !== null) await storage.stop()
  if (database !== null) await database.stop()
}

/** The chain of the suite has to be the one this run starts, so the port has to be free. */
async function assertPortIsFree(port) {
  const net = await import('node:net')
  const taken = await new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
  if (taken) {
    throw new Error(
      `Port ${port} is in use, so the suite would talk to a stack that is not the one it starts. ` +
        'Stop it and run the suite again.',
    )
  }
}

async function startChain() {
  await assertPortIsFree(8545)
  const chain = start('chain', 'bash', ['scripts/chain.sh'], { cwd: ROOT })
  await waitForLine(chain, 'Local chain ready', 120_000)
  await runToEnd('seed', 'pnpm', ['chain:seed'], { cwd: ROOT })
  return chain
}

async function startInternal(databaseUrl) {
  const internal = start(
    'internal',
    'pnpm',
    ['--filter', '@sealflare/internal', 'start'],
    { env: { DATABASE_URL: databaseUrl, INTERNAL_KEY, PORT: String(INTERNAL_PORT) } },
  )
  await waitForLine(internal, 'internal service on port', 60_000)
  return internal
}

/**
 * The indexer reads the Core, the Court and the Vault, so it needs the address of all three.
 * It writes nothing until it has read a range, so the suite waits for the votes of the seed
 * script to appear instead of waiting for a line the indexer never writes.
 */
async function startIndexer(databaseUrl, addresses) {
  const indexer = start(
    'indexer',
    'pnpm',
    ['--filter', '@sealflare/indexer', 'start'],
    {
      env: {
        DATABASE_URL: databaseUrl,
        RPC_URL: ANVIL_URL,
        CHAIN_ID: '31337',
        CORE_ADDRESS: addresses.core,
        COURT_ADDRESS: addresses.court,
        VAULT_ADDRESS: addresses.vault,
        // A local node has no finality: it answers the final block with the genesis block, so
        // the indexer reads up to the tip here.
        BLOCK_TAG: 'latest',
        POLL_INTERVAL_MS: '500',
      },
    },
  )
  await waitForIndexer(indexer)
  return indexer
}

/** Waits until the indexer has read the votes of the seed script. */
async function waitForIndexer(indexer) {
  const deadline = Date.now() + 60_000
  const url = `http://127.0.0.1:${INTERNAL_PORT}/targets/${SEEDED_SKILL_TARGET}/attestations`
  while (Date.now() < deadline) {
    if (indexer.child.exitCode !== null) {
      throw new Error(`The indexer stopped before it read the chain: ${indexer.text().slice(-2000)}`)
    }
    try {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${INTERNAL_KEY}` },
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) return
    } catch {
      // The service is not up yet.
    }
    await sleep(200)
  }
  throw new Error('The indexer did not read the chain in time.')
}

async function startWeb(addresses, storageUrl) {
  const env = {
    INTERNAL_URL: `http://127.0.0.1:${INTERNAL_PORT}`,
    INTERNAL_KEY,
    RPC_URLS: ANVIL_URL,
    BSCSCAN_KEY: 'e2e-placeholder',
    GITHUB_TOKEN: 'e2e-placeholder',
    PINATA_JWT: 'e2e-placeholder',
    PINATA_URL: storageUrl,
    SCANNER: 'mock',
    NEXT_PUBLIC_CHAIN_ID: '31337',
    NEXT_PUBLIC_ADDRESSES_LOCAL: JSON.stringify(addresses),
    NEXT_PUBLIC_MODULES_LIVE: 'false',
    // The official link of the Agent ID is not published yet, so the suite names the local app.
    // The page then offers the way to get one, which the suite needs to see.
    NEXT_PUBLIC_AGENT_ID_URL: `${WEB_URL}/app`,
    // The build offers the wallet of the suite, so a test can sign a vote.
    NEXT_PUBLIC_E2E: 'true',
  }
  await runToEnd('build', 'pnpm', ['--filter', '@sealflare/web', 'build'], { env })
  const web = start(
    'web',
    'pnpm',
    ['--filter', '@sealflare/web', 'exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', String(WEB_PORT)],
    { env },
  )
  await waitForHttp(`${WEB_URL}/app`, 120_000)
  return web
}

async function runSuite() {
  for (let round = 1; round <= RUNS; round += 1) {
    process.stdout.write(`\n=== the suite runs, round ${round} of ${RUNS} ===\n`)
    await runToEnd('playwright', 'pnpm', ['exec', 'playwright', 'test'], {
      cwd: WEB,
      env: {
        PLAYWRIGHT_BASE_URL: WEB_URL,
        // The suite asks the internal service whether the indexer has read a vote.
        E2E_INTERNAL_URL: `http://127.0.0.1:${INTERNAL_PORT}`,
        E2E_INTERNAL_KEY: INTERNAL_KEY,
      },
    })
  }
}

async function main() {
  withFoundryOnPath()
  await assertPortIsFree(INTERNAL_PORT)
  await assertPortIsFree(WEB_PORT)
  storage = await startStorage()
  database = await startDatabase()
  process.stdout.write(`[harness] the database is ${database.url}\n`)
  const addresses = JSON.parse(readFileSync(join(ROOT, 'shared/abi/addresses.local.json'), 'utf8'))
  await startChain()
  await startInternal(database.url)
  await startIndexer(database.url, addresses)
  await startWeb(addresses, storage.url)
  await runSuite()
}

main()
  .then(async () => {
    if (process.env.E2E_KEEP === '1') {
      process.stdout.write('[harness] the stack stays running. Press Ctrl+C to stop it.\n')
      return
    }
    await stopAll()
  })
  .catch(async error => {
    process.stderr.write(`[harness] ${error instanceof Error ? error.message : String(error)}\n`)
    // A stack that is kept is kept even when the suite failed, so the failure can be looked at
    // in the browser.
    if (process.env.E2E_KEEP === '1') {
      process.stdout.write('[harness] the stack stays running. Press Ctrl+C to stop it.\n')
      return
    }
    await stopAll()
    process.exitCode = 1
  })

process.on('SIGINT', () => {
  void stopAll().then(() => process.exit(130))
})
