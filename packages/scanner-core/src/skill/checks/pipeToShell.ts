import { matches, textCheck } from './common'

const PATTERN = /\b(?:curl|wget)\b[^\r\n|]*\|[ \t]*(?:\/(?:usr\/)?bin\/)?(?:sh|bash|zsh|python(?:3)?|node)\b|\beval[ \t]+["']?\$\([ \t]*curl\b|\bbase64[ \t]+(?:-d|--decode)\b[^\r\n|]*\|[ \t]*(?:\/(?:usr\/)?bin\/)?(?:sh|bash|zsh|python(?:3)?|node)\b/gi
export const pipeToShell = textCheck('pipe_to_shell', 'TROJAN_HELPER_SCRIPT',
  'Downloaded or decoded content piped to an interpreter', (text) => matches(text, PATTERN))
