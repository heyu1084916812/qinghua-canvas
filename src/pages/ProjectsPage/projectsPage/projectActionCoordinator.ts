import type { DragEvent } from 'react'
import type { PlatformKit, PickedFile } from '../../../platform/ports'
import type { ProjectRepository } from '../../../state/project/repository'
import {
  exportProject,
  importProjectFile,
  importProjectFromFile,
  type ImportResult,
} from '../../../state/project/flowIo'
import {
  importResultNotice,
  type ProjectNotice,
} from '../projectResultPresentation'

export interface ProjectActionPorts {
  platform: PlatformKit
  repo: ProjectRepository
  status(notice: ProjectNotice): void
  load(): Promise<void>
  busy(): boolean
  setBusy(value: boolean): void
  closeMenu(): void
  setDragging(value: boolean): void
}

export interface ProjectExportOptions {
  embedAssets?: boolean
}

function actionFailureNotice(prefix: string, error: unknown): ProjectNotice {
  return { text: `${prefix}：${(error as Error).message}`, tone: 'error' }
}

/**
 * 菜单导入、拖放导入与导出的动作编排。
 *
 * React 状态仍归页面所有；这里只按端口依次调用既有 flowIo / store 真相，
 * 不复制仓储、文件序列化、提示文案或 busy 锁本身。
 */
export async function applyProjectImportResult(
  result: ImportResult,
  ports: Pick<ProjectActionPorts, 'status' | 'load'>,
): Promise<void> {
  const notice = importResultNotice(result)
  if (!notice) return
  await ports.load()
  ports.status(notice)
}

export async function importProjectFlow(ports: ProjectActionPorts): Promise<void> {
  if (ports.busy()) return
  ports.setBusy(true)
  try {
    const result = await importProjectFile(ports.platform, ports.repo)
    await applyProjectImportResult(result, ports)
  } catch (error) {
    ports.status(actionFailureNotice('导入失败', error))
  } finally {
    ports.setBusy(false)
  }
}

export async function dropProjectFlow(
  ports: ProjectActionPorts,
  event: DragEvent<HTMLDivElement>,
): Promise<void> {
  const file = event.dataTransfer?.files?.[0]
  ports.setDragging(false)
  if (!file) return
  if (!/\.json$/i.test(file.name)) {
    ports.status({
      text: '这里只接受 .flow.json 项目文件（拖进来的是别的类型）',
      tone: 'error',
    })
    return
  }
  event.preventDefault()
  if (ports.busy()) return
  ports.setBusy(true)
  try {
    const result = await importProjectFromFile(
      ports.platform,
      ports.repo,
      {
        name: file.name,
        size: file.size,
        mime: file.type || 'application/json',
        blob: file,
      } satisfies PickedFile,
    )
    await applyProjectImportResult(result, ports)
  } catch (error) {
    ports.status(actionFailureNotice('导入失败', error))
  } finally {
    ports.setBusy(false)
  }
}

export async function exportProjectFlow(
  ports: ProjectActionPorts,
  id: string,
  name: string,
  options: ProjectExportOptions = {},
): Promise<void> {
  if (ports.busy()) return
  ports.setBusy(true)
  ports.closeMenu()
  try {
    const { fileName } = await exportProject(ports.platform, id, {
      ...options,
      onProgress: (done, total) => ports.status({
        text: `导出中 ${done}/${total}…`,
        tone: 'info',
      }),
    })
    ports.status({
      text: `已导出「${name}」为 ${fileName}${options.embedAssets ? '（含素材）' : ''}`,
      tone: 'info',
    })
  } catch (error) {
    ports.status(actionFailureNotice('导出失败', error))
  } finally {
    ports.setBusy(false)
  }
}
