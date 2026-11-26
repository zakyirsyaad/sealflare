#!/usr/bin/env tsx
import { runPrepareAttestation } from '../src/cli'

const result = await runPrepareAttestation(process.argv.slice(2))
process.stdout.write(`${result.output}\n`)
process.exitCode = result.code
