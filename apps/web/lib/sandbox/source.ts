/**
 * The bundle the sandbox runs on: the pinned source and the hash of the bundle at that source.
 *
 * The type lives here and not in the server, because the page and its components both name it.
 */
export type SandboxSource = { src: string; bundleHash: string }
