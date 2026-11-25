#!/usr/bin/env tsx
import { runScanSkill } from '../src/cli'

const result = await runScanSkill(process.argv.slice(2))
process.stdout.write(`${result.output}\n`)
process.exitCode = result.code
