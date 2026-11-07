export const PINTEREST_MAX_PAGES = 20
export const PINTEREST_PAGE_SIZE = 100

export interface PinterestPageResult<T> {
  items: T[]
  truncated: boolean
  pageCount: number
}

/** Read a bounded number of pages and report reaching the safety limit. */
export async function pinterestPagedResult<T>(
  read: (bookmark: string) => Promise<{
    items: unknown[]
    bookmark: string
  }>,
  normalize: (raw: unknown) => T | null,
  idOf: (item: T) => string,
): Promise<PinterestPageResult<T>> {
  const items: T[] = []
  const seen = new Set<string>()
  let bookmark = ''
  let pageCount = 0
  for (let page = 0; page < PINTEREST_MAX_PAGES; page += 1) {
    const payload = await read(bookmark)
    for (const raw of payload.items) {
      const item = normalize(raw)
      if (!item || seen.has(idOf(item))) continue
      seen.add(idOf(item))
      items.push(item)
    }
    bookmark = payload.bookmark
    pageCount = page + 1
    if (!bookmark) break
  }
  return { items, truncated: Boolean(bookmark), pageCount }
}
