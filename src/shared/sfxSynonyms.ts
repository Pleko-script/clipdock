export const SFX_SYNONYM_DICTIONARY_VERSION = 1

const SFX_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['whoosh', 'whooshes', 'swoosh', 'swish', 'wusch', 'zischen'],
  ['impact', 'impacts', 'hit', 'hits', 'aufprall', 'schlag', 'stoß'],
  ['riser', 'risers', 'rise', 'uplifter', 'anstieg', 'steigerung'],
  ['ambience', 'ambient', 'atmosphere', 'roomtone', 'atmo', 'atmosphäre', 'umgebung'],
  ['glitch', 'glitches', 'stutter', 'digitalfehler', 'störung'],
  ['transition', 'transitions', 'trans', 'übergang', 'übergänge'],
  ['foley', 'footstep', 'footsteps', 'steps', 'schritt', 'schritte', 'tritt'],
  ['cloth', 'clothing', 'fabric', 'kleidung', 'stoff'],
  ['door', 'doors', 'tür', 'türen'],
  ['wind', 'windy', 'windstoß', 'windgeräusch']
]

const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu
const synonymsByTerm = new Map<string, readonly string[]>()

for (const group of SFX_SYNONYM_GROUPS) {
  const normalized = [...new Set(group.map((term) => term.toLocaleLowerCase('en-US')))].sort()
  for (const term of normalized) synonymsByTerm.set(term, normalized)
}

export interface ExpandedSfxSearch {
  termGroups: readonly (readonly string[])[]
  relatedTerms: readonly string[]
  expanded: boolean
}

export function expandSfxSearch(search: string, exactOnly = false): ExpandedSfxSearch {
  const tokens = search.toLocaleLowerCase('en-US').match(TOKEN_PATTERN) ?? []
  const relatedTerms = new Set<string>()
  const termGroups = tokens.map((term) => {
    const synonyms = exactOnly ? undefined : synonymsByTerm.get(term)
    if (!synonyms) return [term]
    for (const synonym of synonyms) if (synonym !== term) relatedTerms.add(synonym)
    return synonyms
  })
  return {
    termGroups,
    relatedTerms: [...relatedTerms].sort(),
    expanded: relatedTerms.size > 0
  }
}
