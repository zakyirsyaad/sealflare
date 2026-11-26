import { spawn, type ChildProcess } from 'node:child_process'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'

/**
 * The tests run against the stub contracts on a local Anvil. The chain is started once for the
 * whole run, because starting it for every file is slow and every file needs the same chain.
 */
const PORT = 8546
const RPC_URL = `http://127.0.0.1:${PORT}`
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const DEPLOY_TIMEOUT_MS = 120_000

let anvil: ChildProcess | undefined
let anvilStderr = ''

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function setup(): Promise<void> {
  // A chain that is still shutting down holds the port. Starting on top of it gives a run that
  // talks to a dying node, which reads as missing contracts rather than as a setup problem.
  await waitForFreePort()
  anvil = spawn('anvil', ['--host', '127.0.0.1', '--port', String(PORT), '--chain-id', '31337', '--silent'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  anvil.stderr?.on('data', (chunk) => {
    anvilStderr += String(chunk)
  })
  await waitForChain()
  await deployStubs()
}

export async function teardown(): Promise<void> {
  const child = anvil
  anvil = undefined
  if (!child) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  await Promise.race([exited, sleep(5000)])
  await waitForFreePort()
}

/** Waits until the port answers, or fails when the Anvil of this run dies first. */
async function waitForChain(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (anvil?.exitCode !== null && anvil?.exitCode !== undefined) {
      throw new Error(`Anvil stopped before the chain was up: ${anvilStderr.slice(-2000)}`)
    }
    try {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      })
      if (response.ok) return
    } catch {
      // The chain is not up yet.
    }
    await sleep(100)
  }
  throw new Error(`Anvil did not start on ${RPC_URL}. The indexer tests need anvil and forge.`)
}

/** Waits until nothing listens on the port any more. */
async function waitForFreePort(): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (!(await portIsTaken())) return
    await sleep(100)
  }
  throw new Error(
    `Port ${PORT} is still in use. Another Anvil is running on it, so the tests would talk to a ` +
      `chain that is not the one this run deploys to. Stop it and run the tests again.`,
  )
}

function portIsTaken(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: PORT })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

async function deployStubs(): Promise<void> {
  await run('forge', [
    'script',
    'DeployLocal',
    '--root',
    'contracts',
    '--rpc-url',
    RPC_URL,
    '--broadcast',
    '--unlocked',
    '--sender',
    SENDER,
  ])
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    // A deploy that waits for a receipt that never comes would hold the whole run, so it is
    // given a deadline of its own.
    const deadline = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${command} ${args[0]} did not finish within ${DEPLOY_TIMEOUT_MS} ms.`))
    }, DEPLOY_TIMEOUT_MS)
    child.on('close', (code) => {
      clearTimeout(deadline)
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args[0]} failed with code ${code}: ${stderr.slice(-2000)}`))
    })
  })
}
