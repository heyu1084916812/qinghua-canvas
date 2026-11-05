/** FlowSurface 拖入 / 粘贴导入的收口规则。 */
export interface FlowImportPorts {
  importFiles(files: readonly File[], world: { x: number; y: number }): Promise<void>
  notify(message: string, tone: 'error'): void
}

export function shouldAcceptDraggedFiles(types: readonly string[]): boolean {
  return types.includes('Files')
}

export function shouldPasteMediaFiles(input: {
  files: readonly File[]
  editableTarget: boolean
}): boolean {
  return input.files.length > 0 && !input.editableTarget
}

export function importFeedback(count: number, rejected: number): string | null {
  if (rejected > 0) return `跳过 ${rejected} 个文件：只支持图片 / 视频素材`
  if (count > 0) return `已导入 ${count} 个素材`
  return null
}
