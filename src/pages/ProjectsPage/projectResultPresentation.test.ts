import { describe, expect, it } from 'vitest'
import type { ImportResult } from '../../state/project/flowIo'
import {
  deletionNotice,
  importResultNotice,
  projectCleanupNotice,
  projectFailureNotice,
  trashRestoreNotice,
} from './projectResultPresentation'

function importResult(overrides: Partial<ImportResult> = {}): ImportResult {
  return {
    cancelled: false,
    project: { id: 'p1', name: '导入项目' },
    missingModels: [],
    repaired: { detachedParents: 0, droppedEdges: 0 },
    ...overrides,
  } as ImportResult
}

describe('projectResultPresentation', () => {
  it('取消导入不播报；正常导入保留项目名', () => {
    expect(importResultNotice(importResult({ cancelled: true }))).toBeNull()
    expect(importResultNotice(importResult())).toEqual({
      text: '已导入「导入项目」',
      tone: 'info',
    })
  })

  it('导入修复按缺模型 / 失效归属 / 无效连线顺序合并到同一状态行', () => {
    expect(
      importResultNotice(
        importResult({
          missingModels: ['model-a', 'model-b'],
          repaired: { detachedParents: 1, droppedEdges: 2 },
        }),
      ),
    ).toEqual({
      text:
        '已导入「导入项目」（2 个节点引用了本机没有的模型；' +
        '1 个节点的归属已失效、已放回画布根层；' +
        '2 条连线指向不存在的节点、已清掉）',
      tone: 'info',
    })
  })

  it('失败、删除、还原与清理完成各自保留原有语气和文案', () => {
    expect(projectFailureNotice('删除失败', new Error('disk full'))).toEqual({
      text: '删除失败：disk full',
      tone: 'error',
    })
    expect(deletionNotice(3)).toEqual({ text: '已删除 3 个项目', tone: 'info' })
    expect(trashRestoreNotice(2, 0)).toEqual({ text: '已还原 2 个项目', tone: 'info' })
    expect(trashRestoreNotice(1, 2)).toEqual({
      text: '已还原 1 个，2 个失败并保留选择',
      tone: 'error',
    })
    expect(projectCleanupNotice()).toEqual({
      text: '项目运行态清理完成',
      tone: 'info',
    })
  })
})
