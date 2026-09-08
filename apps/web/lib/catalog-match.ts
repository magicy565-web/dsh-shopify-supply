export const catalogTermMaps: Array<[RegExp, string]> = [
  [/宠物|pet|dog|猫|饮水/, 'pet'],
  [/灯|照明|light|lamp|氛围灯|relight/, 'lamp'],
  [/包|bag|背包|canvas|托特|sleeve|漫游|roam/, 'bag'],
  [/杯|瓶|bottle|咖啡|coffee|drink|手冲/, 'bottle'],
  [/户外|outdoor/, 'outdoor'],
  [/美妆|beauty/, 'beauty'],
]

export function catalogQueryForText(text: string): string {
  const term = text.toLowerCase()
  return catalogTermMaps.find(([match]) => match.test(term))?.[1] ?? ''
}

export function catalogQueryForIdea(idea: { name: string; tagline?: string; category?: string; needs?: string[] }): string {
  return catalogQueryForText([idea.name, idea.tagline, idea.category, ...(idea.needs ?? [])].filter(Boolean).join(' '))
}
