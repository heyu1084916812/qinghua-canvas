import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface ClipperExtensionStatus {
  loadedVersion?: string
  stableVersion?: string
  bundledVersion?: string
  needsUpdate: boolean
  reloadRequired: boolean
  stableDirectory: string
  error?: string
}

interface ClipperExtensionUpdateResult {
  status: ClipperExtensionStatus
  updated: boolean
  openedExtensionPage: boolean
  openError?: string
}

export function useClipperExtensionUpdate() {
  const [status, setStatus] = useState<ClipperExtensionStatus | null>(null)
  const [updating, setUpdating] = useState(false)
  const [message, setMessage] = useState('')

  const accept = useCallback((next: ClipperExtensionStatus | null) => {
    setStatus(next)
  }, [])

  const update = useCallback(async () => {
    if (updating) return
    setUpdating(true)
    setMessage('')
    try {
      const result = await invoke<ClipperExtensionUpdateResult>(
        'clipper_extension_update',
      )
      setStatus(result.status)
      const base = result.updated
        ? '扩展文件已更新，请在扩展页点击“重新加载”。'
        : '扩展文件已是当前版本；如果浏览器仍显示旧版，请在扩展页重新加载。'
      setMessage(result.openedExtensionPage
        ? base
        : `${base} 未能自动打开扩展页，请手动打开浏览器扩展管理页。`)
    } catch (error) {
      setMessage(`更新扩展失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setUpdating(false)
    }
  }, [updating])

  return { status, updating, message, accept, update }
}
