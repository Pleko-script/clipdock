export const COMPARISON_SHORTLIST_LIMIT = 6

export interface ComparisonShortlistChange {
  ids: string[]
  added: boolean
  limitReached: boolean
}

export function addComparisonCandidate(
  ids: readonly string[],
  assetId: string,
  limit = COMPARISON_SHORTLIST_LIMIT
): ComparisonShortlistChange {
  if (ids.includes(assetId)) return { ids: [...ids], added: false, limitReached: false }
  if (ids.length >= limit) return { ids: [...ids], added: false, limitReached: true }
  return { ids: [...ids, assetId], added: true, limitReached: false }
}

export function removeComparisonCandidate(ids: readonly string[], assetId: string): string[] {
  return ids.filter((id) => id !== assetId)
}

export function adjacentComparisonCandidate(
  ids: readonly string[],
  activeId: string | null,
  direction: -1 | 1
): string | null {
  if (!ids.length) return null
  const current = Math.max(0, ids.indexOf(activeId ?? ids[0]))
  return ids[(current + direction + ids.length) % ids.length]
}
