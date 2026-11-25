import type { SignalGroup } from '@sealflare/shared/schemas'

/** Every line the scripts print is English, in sentence case, with no dash and no emoji. */
export function field(label: string, value: string): string {
  return `${label}: ${value}`
}

export function bullet(text: string): string {
  return `- ${text}`
}

/** A titled block. An empty block still shows its title, so nothing is silently left out. */
export function section(title: string, lines: readonly string[]): string {
  if (lines.length === 0) return `${title}\n  none`
  return [title, ...lines.map(line => `  ${line}`)].join('\n')
}

export function join(lines: readonly string[]): string {
  return lines.filter(line => line.length > 0).join('\n')
}

/** The link to the target page of the application. */
export function targetLink(targetId: string): string {
  return `/app/t/${targetId}`
}

/** The link to the scan screen of the application. */
export function scanLink(reference: string): string {
  return `/app?q=${encodeURIComponent(reference)}`
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
