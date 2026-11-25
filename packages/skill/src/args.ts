/** The arguments of a script: named options and free values. Nothing here reads the environment. */
export type Arguments = { values: Record<string, string>; positionals: string[] }

/** What one command accepts. Anything else is an error, so a typo never falls back to a default. */
export type CommandSpec = { options: readonly string[]; maxPositionals: number }

export type ParsedArguments =
  | { ok: true; args: Arguments }
  | { ok: false; message: string }

/**
 * Parses the arguments of a script against what the command accepts.
 *
 * An option is `--name value` or `--name=value`. An option without a value, an option the command
 * does not know, or a free value beyond the allowed number is an error: the script then prints its
 * usage and stops with a non zero exit code.
 */
export function parseArgs(argv: readonly string[], spec: CommandSpec): ParsedArguments {
  const values: Record<string, string> = {}
  const positionals: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index] ?? ''
    if (!item.startsWith('--')) {
      positionals.push(item)
      continue
    }
    const equals = item.indexOf('=')
    const name = equals === -1 ? item.slice(2) : item.slice(2, equals)
    if (!name) return { ok: false, message: `The option ${item} has no name.` }
    if (!spec.options.includes(name)) {
      const allowed = spec.options.map(option => `--${option}`).join(', ')
      return { ok: false, message: `The option --${name} is not known. This command takes ${allowed}.` }
    }
    if (equals !== -1) {
      values[name] = item.slice(equals + 1)
      continue
    }
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      return { ok: false, message: `The option --${name} needs a value.` }
    }
    values[name] = next
    index += 1
  }
  if (positionals.length > spec.maxPositionals) {
    return { ok: false, message: `The argument ${positionals[spec.maxPositionals]} is not expected here.` }
  }
  return { ok: true, args: { values, positionals } }
}

/** The usage of a script, printed when the arguments are wrong. */
export function usage(lines: readonly string[]): string {
  return lines.map(line => (line.length > 0 ? `  ${line}` : '')).join('\n')
}
