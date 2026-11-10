import { invoke } from '@tauri-apps/api/core'

export interface ClipperPendingClip {
  id: string
  url: string
  title?: string
  imageUrl?: string
  receivedAt: number
}

type PendingInvoke = (command: string) => Promise<unknown>

export async function readClipperPendingQueue(
  invokeCommand: PendingInvoke = (command) => invoke(command),
): Promise<{ clips: ClipperPendingClip[]; legacy: boolean }> {
  try {
    return {
      clips: await invokeCommand('clipper_pending_snapshot') as ClipperPendingClip[],
      legacy: false,
    }
  } catch (error) {
    if (!missingCommand(error, 'clipper_pending_snapshot')) throw error
  }
  return {
    clips: await invokeCommand('clipper_take_pending') as ClipperPendingClip[],
    legacy: true,
  }
}

function missingCommand(error: unknown, command: string): boolean {
  const message = String(error)
  return message.includes(command) && message.toLowerCase().includes('not found')
}
