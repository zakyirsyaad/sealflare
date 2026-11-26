import type { SignalGroup } from '@sealflare/shared/schemas'

const BACKSLASH = String.fromCharCode(92)
const LINE_FEED = 0x0a

/** Characters that can move the cursor, hide text or reorder a line when a terminal prints them. */
function isUnsafe(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x206f) ||
    code === 0xfeff
  )
}

function visible(code: number): string {
  return code <= 0xff ? `${BACKSLASH}x${code.toString(16).padStart(2, '0')}` : `${BACKSLASH}u${code.toString(16).padStart(4, '0')}`
}

function escapeWith(value: string, keepLineFeed: boolean): string {
  let out = ''
  for (const item of value) {
    const code = item.codePointAt(0) ?? 0
    out += isUnsafe(code) && !(keepLineFeed && code === LINE_FEED) ? visible(code) : item
  }
  return out
}

/**
 * Text that came from a scanned bundle or from a user, made safe to print.
 *
 * Every control character, line break and invisible formatting character becomes a visible escape
 * such as `\x1b`, so a bundle cannot move the cursor, overwrite a verdict line, or forge a line of
 * the report. Ordinary text is left as it is.
 */
export function escapeText(value: string): string {
  return escapeWith(value, false)
}

/** Every line the scripts print is English, in sentence case, with no dash and no emoji. */
export function field(label: string, value: string): string {
  return `${label}: ${escapeText(value)}`
}

export function bullet(text: string): string {
  return `- ${escapeText(text)}`
}

/** A titled block. An empty block still shows its title, so nothing is silently left out. */
export function section(title: string, lines: readonly string[]): string {
  if (lines.length === 0) return `${title}\n  none`
  return [title, ...lines.map(line => `  ${line}`)].join('\n')
}

/** The lines of a report as one text. The last line of defence: nothing but line feeds survives as a control. */
export function join(lines: readonly string[]): string {
  return neutralize(lines.filter(line => line.length > 0).join('\n'))
}

/** Escapes every control character of a finished text except the line feeds between its lines. */
export function neutralize(text: string): string {
  return escapeWith(text, true)
}

/** The source of a contract in the `?src=` query: the address in lower case, as the app decodes it. */
export function contractSrc(address: string): string {
  return address.toLowerCase()
}

/** The link to the target page of the application, with the source when the page can be rebuilt from it. */
export function targetLink(targetId: string, src?: string): string {
  return src === undefined ? `/app/t/${targetId}` : `/app/t/${targetId}?src=${encodeURIComponent(src)}`
}

/** The link to the scan screen of the application. */
export function scanLink(reference: string): string {
  return `/app?q=${encodeURIComponent(reference)}`
}

/**
 * Removes the endpoint of the command from a text.
 *
 * The endpoint of a paid provider holds its key in the path, and an error of the client prints the
 * endpoint. The key never reaches the output and never reaches a log line.
 */
export function redact(text: string, endpoint?: string): string {
  const without = endpoint === undefined || endpoint.length === 0 ? text : text.split(endpoint).join('the RPC endpoint')
  return without.replace(/https?:\/\/\S+/g, 'the RPC endpoint')
}

export function flagList(names: readonly string[]): string {
  return names.length > 0 ? names.join(', ') : 'none'
}

/** The votes of one group: the three counts and the combined weight. */
export function groupLine(label: string, group: SignalGroup): string {
  const votes = `safe ${group.votes.safe}, caution ${group.votes.caution}, danger ${group.votes.danger}`
  const count = group.votes.safe + group.votes.caution + group.votes.danger
  const weight = group.weight.safe + group.weight.caution + group.weight.danger
  return `${label}: ${votes} (weight ${weight}, ${count} votes)`
}
