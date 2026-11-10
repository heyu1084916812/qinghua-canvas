import type { RowOf, StoragePort, TableName } from '../../platform/ports'
import type { HistoryItem } from '../../domain/shared/assetHistory'
import { buildHistory } from '../../domain/shared/assetHistory'
import { byteLengthOf, normalizeMetaString } from '../../domain/shared/assetLibrary'

/**
 * 「全部生成历史」的仓储（对账 #264）。
 *
 * 与 `assetLibraryRepository` **刻意分成两个文件**：那个的不变量是"只碰 `assetLibrary`，
 * 绝不碰 `assets`"（取消收藏不许动字节）；这里恰恰要**读**`runRecords` / `assets` / `projects` /
 * `assetLibrary` 四张表。合成一个模块，那条"绝不碰"的注释立刻变成假话。
 *
 * ## 为什么 `assets` 必须用 `scan` 分批读
 *
 * `assets` 每行都带**全分辨率字节**：库涨到几 GB 时，`query('assets', {})` 就是把整个库
 * 读进内存（浏览器直接崩）。而历史列表只需要**元数据**（hash / mime / 像素 / 字节数），
 * 所以按批读、**每批只把元数据留下**、字节随批次释放。老后端没有 `scan` 时退回整表
 * （小库两条路等价，这条口径与"导出素材到文件夹"一致）。
 */
export interface AssetHistoryRepository {
  list(): Promise<HistoryItem[]>
  listPage(options?: {
    offset?: number
    limit?: number
  }): Promise<{
    items: HistoryItem[]
    nextOffset: number
    hasMore: boolean
    totalRuns: number
  }>
}

/**
 * 分批大小：下面只请求元数据（`includePayload:false`），不再下发素材字节。
 * 128 行仍只占少量元数据内存，却把 1,400 行素材从约 175 个数据页降到 11 个。
 */
const SCAN_BATCH = 128

const TABLES: TableName[] = ['runRecords', 'assets', 'assetLibrary', 'projects']
export const ASSET_HISTORY_PAGE_SIZE = 30

const RUN_FIELDS = [
  'id',
  'projectId',
  'createdAt',
  'outputHashes',
  'outputWidth',
  'outputHeight',
  'params',
  'sentModel',
  'sentChannelId',
] as const

export function createAssetHistoryRepository(storage: StoragePort): AssetHistoryRepository {
  return {
    async list() {
      const [runs, library, projects] = await Promise.all([
        storage.query(
          'runRecords',
          {},
          {
            includePayload: false,
            fields: [
              'id',
              'projectId',
              'createdAt',
              'outputHashes',
              'outputWidth',
              'outputHeight',
              'params',
              'sentModel',
              'sentChannelId',
            ],
          },
        ),
        storage.query(
          'assetLibrary',
          {},
          { includePayload: false, fields: ['id', 'hash'] },
        ),
        storage.query(
          'projects',
          {},
          { includePayload: false, fields: ['id', 'name'] },
        ),
      ])

      /**
       * 只收**元数据**：`bytes` 当场折算成数字，字节本体不进这个数组 ——
       * 这是"分批"真正省下的东西（否则分批只是把峰值从"1×库"降到"仍然 ≈ 库"）。
       */
      const assets: {
        hash: string
        mime?: string
        width?: number
        height?: number
        bytes: number
      }[] = []
      const collect = (
        rows: readonly {
          hash?: unknown
          id?: unknown
          mime?: unknown
          width?: unknown
          height?: unknown
          bytes?: unknown
          bytesLength?: unknown
        }[],
      ) => {
        for (const row of rows) {
          const hash = normalizeMetaString(row.hash ?? row.id)
          if (!hash) continue
          assets.push({
            hash,
            mime: normalizeMetaString(row.mime),
            width: typeof row.width === 'number' ? row.width : undefined,
            height: typeof row.height === 'number' ? row.height : undefined,
            bytes:
              typeof row.bytesLength === 'number'
                ? row.bytesLength
                : byteLengthOf(row.bytes),
          })
        }
      }

      if (storage.scan) {
        await storage.scan(
          'assets',
          SCAN_BATCH,
          async (rows) => {
            collect(rows as never)
          },
          { includePayload: false },
        )
      } else {
        collect((await storage.query('assets', {})) as never)
      }

      return buildHistory({
        runs: runs as never,
        assets: assets as never,
        savedHashes: library
          .map((row) => normalizeMetaString((row as { hash?: unknown; id?: unknown }).hash ?? (row as { id?: unknown }).id))
          .filter((h): h is string => !!h),
        projects: projects as never,
        includeFailures: false,
      })
    },
    async listPage(options = {}) {
      const offset = Math.max(0, options.offset ?? 0)
      const limit = Math.max(1, options.limit ?? ASSET_HISTORY_PAGE_SIZE)
      let runRows: RowOf<'runRecords'>[]
      let totalRuns: number
      if (storage.queryPage) {
        const page = await storage.queryPage('runRecords', {}, {
          includePayload: false,
          fields: RUN_FIELDS,
          orderBy: { field: 'createdAt', direction: 'desc' },
          offset,
          limit,
        })
        runRows = page.rows
        totalRuns = page.total
      } else {
        const allRuns = await storage.query('runRecords', {}, {
          includePayload: false,
          fields: RUN_FIELDS,
        })
        const sorted = [...allRuns].sort(
          (left, right) =>
            Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0),
        )
        runRows = sorted.slice(offset, offset + limit)
        totalRuns = sorted.length
      }
      const outputHashes = [
        ...new Set(
          runRows.flatMap((run) =>
            Array.isArray(run.outputHashes)
              ? run.outputHashes.filter(
                  (hash): hash is string =>
                    typeof hash === 'string' && hash.length > 0,
                )
              : [],
          ),
        ),
      ]
      const [assetRows, library, projects] = await Promise.all([
        outputHashes.length === 0
          ? Promise.resolve([])
          : storage.queryPage
            ? storage
                .queryPage('assets', {}, {
                  ids: outputHashes,
                  includePayload: false,
                  fields: ['id', 'hash', 'mime', 'width', 'height', 'bytesLength'],
                })
                .then((page) => page.rows)
            : storage
                .query('assets', {}, {
                  includePayload: false,
                  fields: ['id', 'hash', 'mime', 'width', 'height', 'bytesLength'],
                })
                .then((rows) =>
                  rows.filter((row) =>
                    outputHashes.includes(String(row.id)),
                  ),
                ),
        storage.query(
          'assetLibrary',
          {},
          { includePayload: false, fields: ['id', 'hash'] },
        ),
        storage.query(
          'projects',
          {},
          { includePayload: false, fields: ['id', 'name'] },
        ),
      ])
      const normalizedAssets = assetRows.map((row) => {
        const asset = row as {
          id?: unknown
          hash?: unknown
          mime?: unknown
          width?: unknown
          height?: unknown
          bytes?: unknown
          bytesLength?: unknown
        }
        return {
          hash: normalizeMetaString(asset.hash ?? asset.id),
          mime: normalizeMetaString(asset.mime),
          width: typeof asset.width === 'number' ? asset.width : undefined,
          height: typeof asset.height === 'number' ? asset.height : undefined,
          bytes: asset.bytesLength ?? asset.bytes,
        }
      })
      const items = buildHistory({
        runs: runRows as never,
        assets: normalizedAssets as never,
        savedHashes: library
          .map((row) =>
            normalizeMetaString(
              (row as { hash?: unknown; id?: unknown }).hash ??
                (row as { id?: unknown }).id,
            ),
          )
          .filter((hash): hash is string => Boolean(hash)),
        projects: projects as never,
        includeFailures: false,
      })
      const nextOffset = offset + runRows.length
      return {
        items,
        nextOffset,
        hasMore: nextOffset < totalRuns,
        totalRuns,
      }
    },
  }
}

/** 供事务场景复用（与 `ASSET_LIBRARY_TABLES` 同一用途） */
export const ASSET_HISTORY_TABLES = TABLES
