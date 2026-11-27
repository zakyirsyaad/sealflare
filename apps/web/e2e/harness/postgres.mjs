// A throwaway Postgres cluster for the end-to-end suite.
//
// The suite never touches a database that holds anything else. When E2E_DATABASE_URL is given,
// that database is used as it is. A DATABASE_URL in the shell is never read, so the database of a
// developer cannot receive the votes of a run. Otherwise a cluster is created in a temporary
// folder, started on a free port and thrown away when the run ends.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The port the temporary cluster listens on when the run names one. */
const PORT = process.env.E2E_PG_PORT === undefined ? null : Number(process.env.E2E_PG_PORT)

/** Where the Postgres programs may live when they are not on the path. */
const BIN_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/lib/postgresql/15/bin',
  '/usr/lib/postgresql/14/bin',
]

function findProgram(name) {
  const found = spawnSync('which', [name], { encoding: 'utf8' })
  if (found.status === 0 && found.stdout.trim() !== '') return found.stdout.trim()
  for (const dir of BIN_DIRS) {
    const path = join(dir, name)
    if (existsSync(path)) return path
  }
  return null
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim()
    throw new Error(`${program} ${args.join(' ')} failed: ${detail}`)
  }
  return result.stdout.trim()
}

/**
 * A port that nothing listens on.
 *
 * The port is taken by the operating system for a moment, so another program cannot take it
 * between the search and the start of the cluster. A run may name a port itself, and then that
 * one is used.
 */
async function freePort() {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

/**
 * Starts the database the suite runs against. It returns the connection string and the function
 * that stops it again.
 */
export async function startDatabase() {
  if (process.env.E2E_DATABASE_URL) return { url: process.env.E2E_DATABASE_URL, stop: async () => {} }
  const initdb = findProgram('initdb')
  const pgCtl = findProgram('pg_ctl')
  const createdb = findProgram('createdb')
  if (!initdb || !pgCtl || !createdb) {
    throw new Error(
      'Postgres is needed for the end-to-end suite. Install it, or give E2E_DATABASE_URL a database to use.',
    )
  }
  const port = PORT ?? (await freePort())
  const folder = mkdtempSync(join(tmpdir(), 'sealflare-e2e-pg-'))
  const data = join(folder, 'data')
  run(initdb, ['-D', data, '-U', 'postgres', '--auth=trust', '--no-sync'])
  const options = `-p ${port} -k ${folder} -c listen_addresses=127.0.0.1`
  run(pgCtl, ['-D', data, '-o', options, '-l', join(folder, 'postgres.log'), '-w', 'start'])
  run(createdb, ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'sealflare_e2e'])
  const url = `postgres://postgres@127.0.0.1:${port}/sealflare_e2e`
  const stop = async () => {
    try {
      run(pgCtl, ['-D', data, '-m', 'immediate', 'stop'])
    } catch {
      // The cluster is thrown away either way.
    }
    rmSync(folder, { recursive: true, force: true })
  }
  return { url, stop }
}
