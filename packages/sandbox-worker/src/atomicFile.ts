import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

/** Flush a private replacement, then publish it atomically. Directory fsync is unsupported on Windows. */
export function replaceFile(path: string, text: string, committed: () => void): void {
  const dir = dirname(path), temporary = join(dir, `.run-${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600, flush: true })
    fs.renameSync(temporary, path)
    committed() // Rename is visible even if the later directory flush fails.
    if (process.platform !== 'win32') {
      const fd = fs.openSync(dir, fs.constants.O_RDONLY)
      try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    }
  } finally { fs.rmSync(temporary, { force: true }) }
}
