export function agentResearchSourceLabel(source: string): string {
  const normalized = source.trim().toLowerCase()
  if (normalized === 'internetarchive') return 'Internet Archive'
  if (normalized === 'artic') return 'Art Institute'
  if (normalized === 'cleveland') return 'Cleveland Museum'
  if (normalized === 'met') return 'Met Museum'
  if (normalized === 'searxng') return 'SearXNG'
  if (normalized === 'tavily') return 'Tavily'
  if (normalized === 'openverse') return 'Openverse'
  if (normalized === 'wikipedia') return 'Wikipedia'
  if (normalized === 'pinterest') return 'Pinterest'
  if (normalized === 'behance') return 'Behance'
  return source
}
