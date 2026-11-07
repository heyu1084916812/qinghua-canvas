import type { StoragePort } from '../../platform/ports'

/** Count live projects without loading payloads or scanning the table on paged backends. */
export async function countStorageProjects(storage: StoragePort): Promise<number> {
  const queryPage = storage.queryPage?.bind(storage)
  if (queryPage) {
    const page = await queryPage('projects', {}, {
      includePayload: false,
      fields: ['id'],
      missingFields: ['deletedAt'],
      offset: 0,
      limit: 1,
    })
    return page.total
  }
  const scan = storage.scan?.bind(storage)
  if (!scan) {
    return (await storage.query('projects', {}, { includePayload: false })).filter(
      (row) => !row.deletedAt,
    ).length
  }
  let total = 0
  await scan(
    'projects',
    50,
    async (rows) => {
      total += rows.filter((row) => !row.deletedAt).length
    },
    { includePayload: false },
  )
  return total
}
