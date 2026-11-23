import { textCheck } from './common'

const PIN = /(?:^|\/)(?:[0-9a-f]{40}|v?\d+(?:\.\d+){0,2}(?:-[0-9a-z.-]+)?)(?:\/|$)/i

function isMutable(url: URL, prefix: string): boolean {
  if (/^(?:gist\.|pastebin\.)/i.test(url.hostname)) return true
  if (url.hostname.toLowerCase() === 'raw.githubusercontent.com') {
    const revision = url.pathname.split('/')[3] ?? ''
    if (/^(?:main|master|latest)$/i.test(revision)) return true
    if (PIN.test(`/${revision}/`)) return false
  }
  return /\b(?:fetch|download|load)\b[^\r\n.!?]*$/i.test(prefix) && !PIN.test(url.pathname)
}

export const externalDependency = textCheck('external_dependency', 'EXTERNAL_MUTABLE_DEPENDENCY',
  'Unpinned external dependency', (text) => [...text.matchAll(/https?:\/\/[^\s<>"'`\])]+/gi)].flatMap((match) => {
    try {
      const url = new URL(match[0])
      return isMutable(url, text.slice(Math.max(0, match.index - 200), match.index))
        ? [{ index: match.index, length: match[0].length }] : []
    } catch { return [] }
  }))
