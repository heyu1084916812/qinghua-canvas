/**
 * 英文设计博客的题目相关性闸门（2026-11-14）。
 *
 * WordPress 站内搜索是全文 OR 式匹配：BP&O 搜「tea packaging design」前 5 条一条茶都没有（「design」满站都是），
 * Lovely Package 搜「tea packaging」会混进「Beef & Steak」。这些站的结果再过一道闸门：
 * 标题（及题图说明）里至少出现一个**非泛词**（整词）才收；检索词全是泛词时不设闸门。
 * 花瓣 / 站酷 / Cosmos 这类自带相关性排序的站不用。
 */
const GENERIC_TERMS = new Set([
  'design', 'designs', 'designer', 'packaging', 'package', 'packages', 'pack', 'branding', 'brand', 'identity',
  'box', 'boxes', 'label', 'labels', 'inspiration', 'ideas', 'idea', 'reference', 'references', 'trend', 'trends',
  'creative', 'modern', 'minimal', 'minimalist', 'beautiful', 'best', 'the', 'and', 'for', 'of', 'a', 'an', 'with',
])
/** 发给站内搜索前去掉的泛词（packaging / branding 等保留：它们决定是哪类文章）。 */
const QUERY_NOISE = new Set(['design', 'designs', 'inspiration', 'ideas', 'idea', 'reference', 'references', 'trend', 'trends'])

function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9\u00c0-\u024f]+/i).filter(Boolean)
}

/** 站内搜索用的词：去掉泛词；去完为空就用原词。 */
export function siteSearchQuery(query: string): string {
  const kept = query.trim().split(/\s+/).filter((word) => !QUERY_NOISE.has(word.toLowerCase()))
  return kept.length > 0 ? kept.join(' ') : query.trim()
}

/** 判断相关性用的关键词（非泛词、2 个字母以上）；空 = 不设闸门。 */
export function queryKeyTerms(query: string): string[] {
  return [...new Set(wordsOf(query).filter((word) => word.length >= 2 && !GENERIC_TERMS.has(word)))]
}

/** 文本里有没有任一关键词（整词，含 -s / -es 复数）；没有关键词时一律放行。 */
export function mentionsKeyTerm(text: string, keyTerms: readonly string[]): boolean {
  if (keyTerms.length === 0) return true
  const words = new Set(wordsOf(text))
  return keyTerms.some((term) => words.has(term) || words.has(`${term}s`) || words.has(`${term}es`))
}
