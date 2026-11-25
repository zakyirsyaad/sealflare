import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * The tests run against the stub contracts on a local Anvil. The chain is started once for the
 * whole run, because starting it for every file is slow and every file needs the same chain.
 */
const PORT = 8546
const RPC_URL = `http://127.0.0.1:${PORT}`
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

let anvil: ChildProcess | undefined

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function setup(): Promise<void> {
  anvil = spawn('anvil', ['--host', '127.0.0.1', '--port', String(PORT), '--chain-id', '31337', '--silent'], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  await waitForChain()
  await deployStubs()
}

export async function teardown(): Promise<void> {
  anvil?.kill('SIGTERM')
  await sleep(200)
}

async function waitForChain(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
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
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args[0]} failed with code ${code}: ${stderr.slice(-2000)}`))
    })
  })
}
