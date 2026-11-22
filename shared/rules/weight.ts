export type Weight = 0 | 1 | 2 | 3 | 4 | 5

/** Vote weight W(S) for a Guardian score. Negative scores carry no weight. */
export function weightOf(score: number): Weight {
  // A score that is not a whole number is a bug upstream; it must not earn weight.
  if (!Number.isInteger(score) || score < 0) return 0
  if (score < 10) return 1
  if (score < 25) return 2
  if (score < 50) return 3
  if (score < 100) return 4
  return 5
}
