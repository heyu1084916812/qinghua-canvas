import type { PlatformKit } from '../../platform/ports'
import type { ProjectFolder, ProjectListItem } from '../../domain/project/project'
import { buildProjectExport } from '../../state/project/flowIo'

export function joinProjectPath(directory: string, ...parts: string[]): string {
  const separator = directory.includes('\\') ? '\\' : '/'
  return [directory.replace(/[\\/]+$/, ''), ...parts]
    .filter(Boolean)
    .join(separator)
}

export function projectSafeFileName(name: string): string {
  return (name.trim() || '未命名项目').replace(/[\\/:*?"<>|]/g, '_')
}

export async function projectLocalDirectory(
  platform: PlatformKit,
): Promise<string | null> {
  const assetPath = platform.assetFolder?.path?.()
  if (assetPath) return assetPath
  return platform.storageAdmin ? platform.storageAdmin.dataDir() : null
}

export interface ProjectTreeClipboard {
  writeText(value: string): Promise<void>
}

export interface ProjectTreePathStatus {
  text: string
  tone: 'info' | 'error'
}

export interface ProjectTreePathActions {
  copyProjectPath(project: ProjectListItem): Promise<ProjectTreePathStatus>
  copyFolderPath(folder: ProjectFolder): Promise<ProjectTreePathStatus>
  revealProject(): Promise<ProjectTreePathStatus>
  uploadProject(project: ProjectListItem): Promise<ProjectTreePathStatus>
  uploadFolder(folder: ProjectFolder, projects: readonly ProjectListItem[]): Promise<ProjectTreePathStatus>
}

interface ProjectTreePathPorts {
  platform: PlatformKit
  clipboard: ProjectTreeClipboard
  exportProject: typeof buildProjectExport
  onStatus(status: ProjectTreePathStatus): void
}

function failed(prefix: string, error: unknown): ProjectTreePathStatus {
  return {
    text: `${prefix}：${error instanceof Error ? error.message : String(error)}`,
    tone: 'error',
  }
}

/**
 * Owns the tree menu's local-path, file-manager and OSS upload actions.
 * React state, menu position and project repository mutations stay outside.
 */
export function createProjectTreePathActions({
  platform,
  clipboard,
  exportProject,
  onStatus,
}: ProjectTreePathPorts): ProjectTreePathActions {
  const localDirectory = () => projectLocalDirectory(platform)

  const copyProjectPath = async (
    project: ProjectListItem,
  ): Promise<ProjectTreePathStatus> => {
    try {
      const directory = await localDirectory()
      if (!directory) return { text: '本地路径仅在桌面应用可用', tone: 'error' }
      await clipboard.writeText(
        joinProjectPath(directory, `${projectSafeFileName(project.name)}.flow.json`),
      )
      return { text: '项目路径已复制', tone: 'info' }
    } catch (error) {
      return failed('复制路径失败', error)
    }
  }

  const copyFolderPath = async (
    folder: ProjectFolder,
  ): Promise<ProjectTreePathStatus> => {
    try {
      const directory = await localDirectory()
      if (!directory) return { text: '本地路径仅在桌面应用可用', tone: 'error' }
      await clipboard.writeText(joinProjectPath(directory, projectSafeFileName(folder.name)))
      return { text: '文件夹路径已复制', tone: 'info' }
    } catch (error) {
      return failed('复制路径失败', error)
    }
  }

  const revealProject = async (): Promise<ProjectTreePathStatus> => {
    try {
      const directory = await localDirectory()
      if (!directory || !platform.storageAdmin) {
        return { text: '资源管理器仅在桌面应用可用', tone: 'error' }
      }
      await platform.storageAdmin.openDir(directory)
      return { text: '', tone: 'info' }
    } catch (error) {
      return failed('打开资源管理器失败', error)
    }
  }

  const uploadProject = async (
    project: ProjectListItem,
  ): Promise<ProjectTreePathStatus> => {
    onStatus({ text: `正在打包「${project.name}」…`, tone: 'info' })
    try {
      const payload = await exportProject(platform, project.id, { embedAssets: true })
      onStatus({ text: '正在上传到 OSS…', tone: 'info' })
      const result = await platform.hosting.upload({
        blob: payload.blob,
        name: payload.fileName,
      })
      if (!result) {
        return {
          text: '素材传输还没有配置，先到全局设置 → 素材传输选择 OSS',
          tone: 'error',
        }
      }
      await clipboard.writeText(result.url)
      return { text: '项目已上传，公网直链已复制', tone: 'info' }
    } catch (error) {
      return failed('上传失败', error)
    }
  }

  const uploadFolder = async (
    folder: ProjectFolder,
    projects: readonly ProjectListItem[],
  ): Promise<ProjectTreePathStatus> => {
    const inside = projects.filter((project) => project.folderId === folder.id)
    if (inside.length === 0) {
      return { text: '这个文件夹里没有可上传的项目', tone: 'info' }
    }
    let uploaded = 0
    try {
      for (const project of inside) {
        onStatus({
          text: `正在上传 ${uploaded + 1}/${inside.length}：${project.name}`,
          tone: 'info',
        })
        const payload = await exportProject(platform, project.id, { embedAssets: true })
        const result = await platform.hosting.upload({
          blob: payload.blob,
          name: `${projectSafeFileName(folder.name)}-${payload.fileName}`,
        })
        if (!result) {
          return {
            text: '素材传输还没有配置，先到全局设置 → 素材传输选择 OSS',
            tone: 'error',
          }
        }
        uploaded += 1
      }
      return {
        text: `文件夹已上传 ${uploaded}/${inside.length} 个项目`,
        tone: 'info',
      }
    } catch (error) {
      return {
        text: `上传文件夹失败（已完成 ${uploaded}/${inside.length}）：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      }
    }
  }

  return { copyProjectPath, copyFolderPath, revealProject, uploadProject, uploadFolder }
}
