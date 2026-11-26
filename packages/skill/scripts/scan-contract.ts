#!/usr/bin/env tsx
import { runScanContract } from '../src/cli'

const result = await runScanContract(process.argv.slice(2))
process.stdout.write(`${result.output}\n`)
process.exitCode = result.code
