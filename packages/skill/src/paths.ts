import { resolve, sep } from 'node:path'

/**
 * The absolute path of something the user typed.
 *
 * pnpm runs a script with the folder of the package as its working directory, so a relative path
 * would land inside this package. `INIT_CWD` is the folder the user typed the command in. Without
 * it, for example when the script runs directly, the working directory is used.
 */
export function resolveInputPath(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path)
}

/** A path in the form the registry uses: the parts are separated by a slash, on every system. */
export function toPosix(path: string): string {
  return path.split(sep).join('/')
}
